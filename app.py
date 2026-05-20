import os
import secrets
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from bson import ObjectId
from pymongo import MongoClient
from pymongo.errors import ConfigurationError

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-session-secret-change-me")

DISCORD_API_BASE = "https://discord.com/api/v10"
DISCORD_REQUEST_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "AurixWebsiteOAuth/1.0 (https://aurawebsite-12gd.onrender.com)",
}
MANAGE_GUILD_PERMISSION = 0x20
ADMINISTRATOR_PERMISSION = 0x8
mongo_client = None


@app.after_request
def add_cors_headers(response):
    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    origin = request.headers.get("Origin")

    if frontend_url and origin == frontend_url:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"

    return response


def require_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def get_discord_redirect_uri():
    configured = os.environ.get("DISCORD_REDIRECT_URI", "").strip()
    if configured:
        normalized = configured.rstrip("/")
        if not normalized.endswith("/auth/discord/callback"):
            return f"{normalized}/auth/discord/callback"
        return normalized

    frontend_url = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
    if frontend_url:
        return f"{frontend_url}/auth/discord/callback"

    return request.url_root.rstrip("/") + "/auth/discord/callback"


def exchange_discord_code(code):
    data = urlencode({
        "client_id": require_env("DISCORD_CLIENT_ID"),
        "client_secret": require_env("DISCORD_CLIENT_SECRET"),
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": get_discord_redirect_uri(),
    }).encode("utf-8")

    req = Request(
        f"{DISCORD_API_BASE}/oauth2/token",
        data=data,
        headers={
            **DISCORD_REQUEST_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )

    with urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_discord_user(access_token):
    req = Request(
        f"{DISCORD_API_BASE}/users/@me",
        headers={
            **DISCORD_REQUEST_HEADERS,
            "Authorization": f"Bearer {access_token}",
        },
    )

    with urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def discord_get(path, token, is_bot=False):
    auth_prefix = "Bot" if is_bot else "Bearer"
    req = Request(
        f"{DISCORD_API_BASE}{path}",
        headers={
            **DISCORD_REQUEST_HEADERS,
            "Authorization": f"{auth_prefix} {token}",
        },
    )

    with urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def get_mongo_db():
    global mongo_client
    if mongo_client is None:
        mongo_client = MongoClient(require_env("MONGODB_URI"))

    try:
        db = mongo_client.get_default_database()
    except ConfigurationError:
        db = None
    return db if db is not None else mongo_client["aurix"]


def role_listings_collection():
    return get_mongo_db()["rolelistings"]


def get_bot_token():
    return os.environ.get("DISCORD_BOT_TOKEN", "").strip() or os.environ.get("DISCORD_TOKEN", "").strip()


def serialize_listing(listing):
    return {
        "id": str(listing["_id"]),
        "guildId": listing.get("guildId"),
        "roleId": listing.get("roleId"),
        "name": listing.get("name"),
        "description": listing.get("description", ""),
        "price": int(listing.get("price", 0)),
        "enabled": bool(listing.get("enabled", True)),
        "purchaseCount": int(listing.get("purchaseCount", 0)),
        "updatedAt": listing.get("updatedAt").isoformat() if listing.get("updatedAt") else None,
    }


def user_can_manage_guild(guild):
    permissions = int(guild.get("permissions", 0))
    return bool(guild.get("owner")) or bool(permissions & ADMINISTRATOR_PERMISSION) or bool(permissions & MANAGE_GUILD_PERMISSION)


def require_dashboard_session():
    user = session.get("discord_user")
    access_token = session.get("discord_access_token")
    if not user or not access_token:
        return None, None, (jsonify({"error": "Login with Discord first."}), 401)
    return user, access_token, None


def get_manageable_guild(access_token, guild_id):
    guilds = discord_get("/users/@me/guilds", access_token)
    return next((guild for guild in guilds if guild.get("id") == guild_id and user_can_manage_guild(guild)), None)


def fetch_assignable_roles(guild_id):
    bot_token = get_bot_token()
    if not bot_token:
        raise RuntimeError("Missing DISCORD_BOT_TOKEN or DISCORD_TOKEN for dashboard role loading.")

    roles = discord_get(f"/guilds/{guild_id}/roles", bot_token, is_bot=True)
    return [
        {
            "id": role["id"],
            "name": role["name"],
            "position": role.get("position", 0),
            "managed": bool(role.get("managed")),
        }
        for role in roles
        if role.get("id") != guild_id and not role.get("managed")
    ]


def safe_discord_error(error_body):
    try:
        payload = json.loads(error_body)
    except json.JSONDecodeError:
        return error_body[:300]

    return json.dumps({
        "error": payload.get("error"),
        "error_description": payload.get("error_description"),
        "message": payload.get("message"),
    })


@app.route("/")
def home():
    return send_from_directory(".", "index.html")


@app.route("/debug/config")
def debug_config():
    redirect_uri = get_discord_redirect_uri()
    frontend_url = os.environ.get("FRONTEND_URL", "").strip()

    return jsonify({
        "discord_client_id_set": bool(os.environ.get("DISCORD_CLIENT_ID", "").strip()),
        "discord_client_secret_set": bool(os.environ.get("DISCORD_CLIENT_SECRET", "").strip()),
        "discord_redirect_uri": redirect_uri,
        "frontend_url": frontend_url or None,
        "session_secret_set": bool(os.environ.get("SESSION_SECRET", "").strip()),
    })


@app.route("/auth/discord")
def discord_login():
    state = secrets.token_urlsafe(24)
    session["discord_oauth_state"] = state
    params = {
        "client_id": require_env("DISCORD_CLIENT_ID"),
        "redirect_uri": get_discord_redirect_uri(),
        "response_type": "code",
        "scope": "identify guilds",
        "state": state,
    }

    return redirect(f"https://discord.com/oauth2/authorize?{urlencode(params)}")


@app.route("/auth/discord/callback")
def discord_callback():
    code = request.args.get("code", "")
    state = request.args.get("state", "")
    expected_state = session.get("discord_oauth_state")

    if not code:
        return send_from_directory(".", "index.html")

    if not state:
        print("Discord login failed: callback missing state")
        return "Discord login failed: missing state.", 400

    if state != expected_state:
        print("Discord login failed: state mismatch")
        return "Discord login failed: session expired. Please start login again.", 400

    session.pop("discord_oauth_state", None)

    try:
        token = exchange_discord_code(code)
        user = fetch_discord_user(token["access_token"])
    except HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        print(f"Discord login failed: HTTP {error.code} {error_body}")
        return f"Discord login failed: Discord returned HTTP {error.code}. {safe_discord_error(error_body)}", 500
    except (URLError, KeyError, RuntimeError) as error:
        print(f"Discord login failed: {error}")
        return f"Discord login failed: {error}", 500

    session["discord_user"] = {
        "id": user["id"],
        "username": user["username"],
        "global_name": user.get("global_name"),
        "avatar": user.get("avatar"),
    }
    session["discord_access_token"] = token["access_token"]

    return redirect(os.environ.get("FRONTEND_URL", "/"))


@app.route("/logout", methods=["POST", "OPTIONS"])
def logout():
    if request.method == "OPTIONS":
        return "", 204

    session.pop("discord_user", None)
    session.pop("discord_access_token", None)
    return jsonify({"ok": True})


@app.route("/api/me")
def current_user():
    user = session.get("discord_user")
    if not user:
        return jsonify({"user": None, "authenticated": False}), 401

    return jsonify({"user": user, "authenticated": True})


@app.route("/api/dashboard/guilds")
def dashboard_guilds():
    _user, access_token, error = require_dashboard_session()
    if error:
        return error

    try:
        guilds = discord_get("/users/@me/guilds", access_token)
    except HTTPError as error:
        return jsonify({"error": f"Discord guild lookup failed with HTTP {error.code}."}), 502

    manageable = [
        {
            "id": guild["id"],
            "name": guild["name"],
            "icon": guild.get("icon"),
            "owner": bool(guild.get("owner")),
        }
        for guild in guilds
        if user_can_manage_guild(guild)
    ]
    return jsonify({"guilds": manageable})


@app.route("/api/dashboard/guilds/<guild_id>/roles")
def dashboard_roles(guild_id):
    _user, access_token, error = require_dashboard_session()
    if error:
        return error
    if not get_manageable_guild(access_token, guild_id):
        return jsonify({"error": "You need Manage Server or Administrator for this server."}), 403

    try:
        return jsonify({"roles": sorted(fetch_assignable_roles(guild_id), key=lambda role: role["position"], reverse=True)})
    except HTTPError as error:
        return jsonify({"error": f"Aurix could not load roles for this server. Make sure the bot is in the server. HTTP {error.code}."}), 502
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/dashboard/guilds/<guild_id>/role-listings", methods=["GET", "POST", "OPTIONS"])
def dashboard_role_listings(guild_id):
    if request.method == "OPTIONS":
        return "", 204

    user, access_token, error = require_dashboard_session()
    if error:
        return error
    if not get_manageable_guild(access_token, guild_id):
        return jsonify({"error": "You need Manage Server or Administrator for this server."}), 403

    collection = role_listings_collection()
    if request.method == "GET":
        listings = collection.find({"guildId": guild_id}).sort("price", 1)
        return jsonify({"listings": [serialize_listing(listing) for listing in listings]})

    payload = request.get_json(silent=True) or {}
    role_id = str(payload.get("roleId", "")).strip()
    description = str(payload.get("description", "")).strip()[:180]
    try:
        price = int(payload.get("price") or 0)
    except (TypeError, ValueError):
        price = 0
    enabled = bool(payload.get("enabled", True))

    if price < 1:
        return jsonify({"error": "Price must be at least 1 aura."}), 400

    try:
        roles = fetch_assignable_roles(guild_id)
    except HTTPError as error:
        return jsonify({"error": f"Aurix could not verify that role. HTTP {error.code}."}), 502
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500

    role = next((item for item in roles if item["id"] == role_id), None)
    if not role:
        return jsonify({"error": "Choose a role that Aurix can see and assign."}), 400

    collection.update_one(
        {"guildId": guild_id, "roleId": role_id},
        {
            "$set": {
                "name": role["name"],
                "description": description,
                "price": price,
                "enabled": enabled,
                "updatedBy": user["id"],
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {
                "guildId": guild_id,
                "roleId": role_id,
                "createdBy": user["id"],
                "purchaseCount": 0,
                "createdAt": datetime.utcnow(),
            },
        },
        upsert=True,
    )
    listing = collection.find_one({"guildId": guild_id, "roleId": role_id})
    return jsonify({"listing": serialize_listing(listing)})


@app.route("/api/dashboard/role-listings/<listing_id>/toggle", methods=["POST", "OPTIONS"])
def dashboard_toggle_role_listing(listing_id):
    if request.method == "OPTIONS":
        return "", 204

    _user, access_token, error = require_dashboard_session()
    if error:
        return error

    try:
        object_id = ObjectId(listing_id)
    except Exception:
        return jsonify({"error": "Invalid listing id."}), 400

    collection = role_listings_collection()
    listing = collection.find_one({"_id": object_id})
    if not listing:
        return jsonify({"error": "Listing not found."}), 404
    if not get_manageable_guild(access_token, listing["guildId"]):
        return jsonify({"error": "You need Manage Server or Administrator for this server."}), 403

    enabled = bool((request.get_json(silent=True) or {}).get("enabled"))
    collection.update_one({"_id": object_id}, {"$set": {"enabled": enabled, "updatedAt": datetime.utcnow()}})
    listing = collection.find_one({"_id": object_id})
    return jsonify({"listing": serialize_listing(listing)})


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(".", path)


@app.route("/contact", methods=["POST"])
def contact():
    email = request.form.get("email", "").strip()

    if not email:
        return jsonify({"error": "Email is required."}), 400

    return jsonify({"message": "Thanks, your email was received."})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
