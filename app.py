import os
import secrets
import hashlib
import time
from datetime import datetime
from datetime import timedelta
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
app.config.update(
    SESSION_COOKIE_SAMESITE=os.environ.get("SESSION_COOKIE_SAMESITE", "None"),
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").strip().lower() != "false",
)

DISCORD_API_BASE = "https://discord.com/api/v10"
DISCORD_REQUEST_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "AurixWebsiteOAuth/1.0 (https://aurawebsite-12gd.onrender.com)",
}
MANAGE_GUILD_PERMISSION = 0x20
ADMINISTRATOR_PERMISSION = 0x8
MANAGE_ROLES_PERMISSION = 0x10000000
mongo_client = None
memory_cache = {}
CACHE_TTL_SECONDS = int(os.environ.get("DASHBOARD_CACHE_TTL_SECONDS", "300"))


@app.after_request
def add_cors_headers(response):
    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    origin = request.headers.get("Origin")

    if frontend_url and origin == frontend_url:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"

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


def cache_get(key):
    cached = memory_cache.get(key)
    if not cached:
        return None

    expires_at, value = cached
    if expires_at <= time.time():
        memory_cache.pop(key, None)
        return None

    return value


def cache_set(key, value, ttl=CACHE_TTL_SECONDS):
    memory_cache[key] = (time.time() + ttl, value)
    return value


def get_mongo_db():
    global mongo_client
    if mongo_client is None:
        mongo_client = MongoClient(require_env("MONGODB_URI"))

    try:
        db = mongo_client.get_default_database()
    except ConfigurationError:
        db = None
    return db if db is not None else mongo_client["aurix"]


def get_community_db():
    global mongo_client
    if mongo_client is None:
        mongo_client = MongoClient(require_env("MONGODB_URI"))

    configured = os.environ.get("COMMUNITY_DB_NAME", "aurixDB").strip()
    return mongo_client[configured] if configured else get_mongo_db()


def get_database_candidates():
    global mongo_client
    if mongo_client is None:
        mongo_client = MongoClient(require_env("MONGODB_URI"))

    candidates = []
    configured_names = [
        os.environ.get("LIVE_DB_NAME", "").strip(),
        os.environ.get("COMMUNITY_DB_NAME", "").strip(),
    ]
    for db in [get_mongo_db(), *(mongo_client[name] for name in configured_names if name)]:
        if db.name not in [candidate.name for candidate in candidates]:
            candidates.append(db)

    for name in ["test", "aurix", "aurixDB"]:
        if name not in [candidate.name for candidate in candidates]:
            candidates.append(mongo_client[name])

    try:
        for name in mongo_client.list_database_names():
            if name not in [candidate.name for candidate in candidates]:
                candidates.append(mongo_client[name])
    except Exception:
        pass

    return candidates


def role_listings_collection():
    return get_mongo_db()["rolelistings"]


def dashboard_sessions_collection():
    return get_mongo_db()["dashboardsessions"]


def oauth_states_collection():
    return get_mongo_db()["oauthstates"]


def configured_collection_names(env_name, defaults):
    configured = os.environ.get(env_name, "").strip()
    if not configured:
        return defaults
    return [name.strip() for name in configured.split(",") if name.strip()]


def first_existing_collection(collection_names, db=None):
    db = get_mongo_db() if db is None else db
    existing = set(db.list_collection_names())
    for name in collection_names:
        if name in existing:
            return db[name]
    return None


def first_existing_collection_across_dbs(collection_names):
    for db in get_database_candidates():
        collection = first_existing_collection(collection_names, db)
        if collection is not None:
            return collection
    return None


def latest_document(collection):
    for sort_field in ("updatedAt", "createdAt", "checkedAt", "_id"):
        document = collection.find_one(sort=[(sort_field, -1)])
        if document:
            return document
    return collection.find_one()


def first_present(document, field_names):
    if not document:
        return None
    for field_name in field_names:
        value = field_value(document, field_name)
        if value is not None and value != "":
            return value
    return None


def field_value(document, field_name):
    value = document
    for part in field_name.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def normalize_metric_name(value):
    return "".join(char for char in str(value or "").lower() if char.isalnum())


def list_from_document(document, field_names):
    if not document:
        return []
    for field_name in field_names:
        value = document.get(field_name)
        if isinstance(value, list):
            return value
    return []


def format_stat_value(value):
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return value
    try:
        return format_number(value)
    except (TypeError, ValueError):
        return str(value)


def numeric_total(collection, field_names):
    for field_name in field_names:
        result = list(collection.aggregate([
            {
                "$group": {
                    "_id": None,
                    "total": {
                        "$sum": {
                            "$convert": {
                                "input": f"${field_name}",
                                "to": "long",
                                "onError": 0,
                                "onNull": 0,
                            }
                        }
                    },
                }
            }
        ]))
        total = int(result[0]["total"]) if result else 0
        if total > 0:
            return total
    return 0


def latest_leaderboard(collection):
    aura_fields = [
        "aura", "stats.aura", "profile.aura", "economy.aura", "currency.aura",
        "balance", "wallet", "money", "points", "score", "xp", "totalAura",
    ]
    name_fields = [
        "username", "displayName", "globalName", "global_name", "name",
        "userName", "discordName", "discord.username", "profile.username",
    ]

    for aura_field in aura_fields:
        players = list(collection.aggregate([
            {
                "$addFields": {
                    "_aurixScore": {
                        "$convert": {
                            "input": f"${aura_field}",
                            "to": "long",
                            "onError": 0,
                            "onNull": 0,
                        }
                    }
                }
            },
            {"$match": {"_aurixScore": {"$gt": 0}}},
            {"$sort": {"_aurixScore": -1}},
            {"$limit": 5},
        ]))
        if players:
            leaderboard = []
            for index, player in enumerate(players, start=1):
                name = first_present(player, name_fields)
                leaderboard.append({
                    "rank": index,
                    "name": str(name or player.get("userId") or player.get("discordId") or "Aurix Player"),
                    "aura": format_number(player.get("_aurixScore", 0)),
                })
            return leaderboard
    return []


def collection_leaderboard(collection):
    rank_fields = ["rank", "position", "place"]
    aura_fields = [
        "aura", "stats.aura", "profile.aura", "economy.aura", "currency.aura",
        "balance", "wallet", "money", "points", "score", "xp", "totalAura",
    ]
    name_fields = [
        "username", "displayName", "globalName", "global_name", "name",
        "userName", "discordName", "discord.username", "profile.username",
    ]

    document = latest_document(collection)
    embedded_players = list_from_document(document, ["leaderboard", "players", "items", "entries", "data"])
    if embedded_players:
        return normalize_leaderboard_players(embedded_players, rank_fields, aura_fields, name_fields)

    sort_field = next((field for field in rank_fields + aura_fields if collection.find_one({field: {"$exists": True}})), "_id")
    sort_direction = 1 if sort_field in rank_fields else -1
    return normalize_leaderboard_players(
        list(collection.find({}).sort(sort_field, sort_direction).limit(5)),
        rank_fields,
        aura_fields,
        name_fields,
    )


def normalize_leaderboard_players(players, rank_fields, aura_fields, name_fields):
    leaderboard = []
    for index, player in enumerate(players[:5], start=1):
        if not isinstance(player, dict):
            continue
        name = first_present(player, name_fields) or first_present(player, ["userId", "discordId", "id"]) or "Aurix Player"
        score = first_present(player, aura_fields) or 0
        rank = first_present(player, rank_fields) or index
        leaderboard.append({
            "rank": rank,
            "name": str(name),
            "aura": format_stat_value(score) or "0",
        })
    return leaderboard


def collection_testimonials(collection):
    document = latest_document(collection)
    embedded_testimonials = list_from_document(document, ["testimonials", "reviews", "items", "entries", "data"])
    if embedded_testimonials:
        return normalize_testimonials(embedded_testimonials)

    return normalize_testimonials(list(collection.find({}).sort("_id", -1).limit(3)))


def normalize_testimonials(records):
    testimonials = []
    for testimonial in records[:3]:
        if not isinstance(testimonial, dict):
            continue
        text = first_present(testimonial, ["text", "quote", "message", "body"])
        author = first_present(testimonial, ["author", "username", "name", "displayName"])
        if text:
            testimonials.append({
                "text": str(text),
                "author": str(author or "Aurix Player"),
            })
    return testimonials


def collection_stats(collection):
    document = latest_document(collection)
    if not document:
        return {}

    metric_stats = stats_from_metric_documents(collection)
    if metric_stats:
        return metric_stats

    stats = document.get("stats") if isinstance(document.get("stats"), dict) else document
    return {
        "activePlayers": format_stat_value(first_present(stats, [
            "activePlayers", "active_players", "players", "totalPlayers", "totalUsers", "users", "userCount",
        ])),
        "competitions": format_stat_value(first_present(stats, [
            "competitions", "competitionCount", "matches", "pvpMatches", "events", "challenges",
        ])),
        "auraTracked": format_stat_value(first_present(stats, [
            "auraTracked", "totalAura", "aura", "economyTotal", "totalBalance", "pointsTracked",
        ])),
        "uptime": format_stat_value(first_present(stats, ["uptime", "uptimePercent", "availability"])),
    }


def stats_from_metric_documents(collection):
    stat_aliases = {
        "activePlayers": {"activeplayers", "activeplayer", "players", "totalplayers", "totalusers", "users", "usercount"},
        "competitions": {"competitions", "competitioncount", "matches", "pvpmatches", "events", "challenges"},
        "auraTracked": {"auratracked", "totalaura", "aura", "economytotal", "totalbalance", "pointstracked"},
        "uptime": {"uptime", "uptimepercent", "availability"},
    }
    value_fields = ["value", "count", "total", "amount", "number", "score"]
    key_fields = ["key", "name", "metric", "label", "type", "stat"]
    stats = {}

    for document in collection.find({}).limit(50):
        metric = normalize_metric_name(first_present(document, key_fields))
        value = first_present(document, value_fields)
        if not metric or value is None:
            continue
        for stat_name, aliases in stat_aliases.items():
            if metric in aliases:
                stats[stat_name] = format_stat_value(value)
                break

    return stats


def format_number(value):
    return f"{int(value):,}"


def build_live_community_data():
    site_content_db = get_community_db()
    stats_collection = first_existing_collection(configured_collection_names(
        "COMMUNITY_STATS_COLLECTIONS",
        ["stats"],
    ), site_content_db)
    leaderboard_collection = first_existing_collection(configured_collection_names(
        "COMMUNITY_LEADERBOARD_COLLECTIONS",
        ["leaderboard"],
    ), site_content_db)
    testimonials_collection = first_existing_collection(configured_collection_names(
        "COMMUNITY_TESTIMONIALS_COLLECTIONS",
        ["testimonials"],
    ), site_content_db)
    player_collection = first_existing_collection_across_dbs(configured_collection_names(
        "COMMUNITY_PLAYERS_COLLECTIONS",
        ["players", "users", "profiles", "economy", "members"],
    ))
    competition_collection = first_existing_collection_across_dbs(configured_collection_names(
        "COMMUNITY_COMPETITIONS_COLLECTIONS",
        ["competitions", "challenges", "duels", "battles", "events", "pvpmatchmakingqueues", "rolepurchases"],
    ))

    has_live_players = player_collection is not None
    fallback_stats = collection_stats(stats_collection) if stats_collection is not None and not has_live_players else {}
    active_players = (
        format_number(player_collection.count_documents({}))
        if has_live_players else fallback_stats.get("activePlayers") or "0"
    )
    competitions = (
        format_number(competition_collection.count_documents({}))
        if competition_collection is not None else fallback_stats.get("competitions") or "0"
    )
    aura_tracked = (
        format_number(numeric_total(
            player_collection,
            [
                "aura", "stats.aura", "profile.aura", "economy.aura", "currency.aura",
                "balance", "wallet", "money", "points", "score", "xp", "totalAura",
            ],
        ))
        if has_live_players else fallback_stats.get("auraTracked") or "0"
    )
    leaderboard = latest_leaderboard(player_collection) if has_live_players else (
        collection_leaderboard(leaderboard_collection) if leaderboard_collection is not None else []
    )
    testimonials = collection_testimonials(testimonials_collection) if testimonials_collection is not None else []
    uptime = os.environ.get("COMMUNITY_UPTIME", "99.8%").strip() or "99.8%"

    payload = {
        "stats": {
            "activePlayers": active_players,
            "competitions": competitions,
            "auraTracked": aura_tracked,
            "uptime": fallback_stats.get("uptime") or uptime,
        },
        "source": player_collection.full_name if player_collection is not None else "static fallback",
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    }
    if leaderboard:
        payload["leaderboard"] = leaderboard
    if testimonials:
        payload["testimonials"] = testimonials
    return payload


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


def hash_dashboard_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_dashboard_session(user, access_token):
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(days=7)
    dashboard_sessions_collection().update_one(
        {"tokenHash": hash_dashboard_token(token)},
        {
            "$set": {
                "user": user,
                "accessToken": access_token,
                "expiresAt": expires_at,
                "updatedAt": datetime.utcnow(),
            },
            "$setOnInsert": {"createdAt": datetime.utcnow()},
        },
        upsert=True,
    )
    return token


def create_oauth_state(return_to):
    state = secrets.token_urlsafe(24)
    oauth_states_collection().update_one(
        {"state": state},
        {
            "$set": {
                "returnTo": return_to,
                "expiresAt": datetime.utcnow() + timedelta(minutes=10),
                "createdAt": datetime.utcnow(),
            },
        },
        upsert=True,
    )
    return state


def consume_oauth_state(state):
    record = oauth_states_collection().find_one_and_delete({
        "state": state,
        "expiresAt": {"$gt": datetime.utcnow()},
    })
    return record or {}


def require_dashboard_auth():
    user = session.get("discord_user")
    access_token = session.get("discord_access_token")
    if user and access_token:
        return user, access_token, None

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, None, (jsonify({"error": "Login with Discord first."}), 401)

    token = auth_header.removeprefix("Bearer ").strip()
    if not token:
        return None, None, (jsonify({"error": "Login with Discord first."}), 401)

    record = dashboard_sessions_collection().find_one({
        "tokenHash": hash_dashboard_token(token),
        "expiresAt": {"$gt": datetime.utcnow()},
    })
    if not record:
        return None, None, (jsonify({"error": "Dashboard login expired. Login with Discord again."}), 401)

    return record["user"], record["accessToken"], None


def get_manageable_guild(access_token, guild_id):
    guilds = discord_get("/users/@me/guilds", access_token)
    return next((guild for guild in guilds if guild.get("id") == guild_id and user_can_manage_guild(guild)), None)


def fetch_role_dashboard_state(guild_id):
    cache_key = f"guild_roles:{guild_id}"
    cached_state = cache_get(cache_key)
    if cached_state is not None:
        return cached_state

    bot_token = get_bot_token()
    if not bot_token:
        raise RuntimeError("Missing DISCORD_BOT_TOKEN or DISCORD_TOKEN for dashboard role loading.")

    roles = discord_get(f"/guilds/{guild_id}/roles", bot_token, is_bot=True)
    bot_member = discord_get(f"/guilds/{guild_id}/members/@me", bot_token, is_bot=True)
    bot_role_ids = set(bot_member.get("roles", []))
    bot_roles = [role for role in roles if role.get("id") in bot_role_ids]
    bot_highest_position = max((int(role.get("position", 0)) for role in bot_roles), default=0)
    bot_permissions = 0
    for role in bot_roles:
        try:
            bot_permissions |= int(role.get("permissions", 0))
        except (TypeError, ValueError):
            pass

    bot_can_manage_roles = bool(bot_permissions & ADMINISTRATOR_PERMISSION) or bool(bot_permissions & MANAGE_ROLES_PERMISSION)
    assignable_roles = [
        {
            "id": role["id"],
            "name": role["name"],
            "position": role.get("position", 0),
            "managed": bool(role.get("managed")),
        }
        for role in roles
        if role.get("id") != guild_id
        and not role.get("managed")
        and int(role.get("position", 0)) < bot_highest_position
    ]
    validation = {
        "canManageRoles": bot_can_manage_roles,
        "botHighestPosition": bot_highest_position,
        "assignableRoleCount": len(assignable_roles),
        "ok": bot_can_manage_roles and bot_highest_position > 0,
    }
    if not bot_can_manage_roles:
        validation["message"] = "Aurix needs the Manage Roles permission before role listings can be saved."
    elif bot_highest_position <= 0:
        validation["message"] = "Aurix needs a server role above the roles you want to sell."
    elif not assignable_roles:
        validation["message"] = "No assignable roles found. Move the Aurix bot role above the roles you want to sell."
    else:
        validation["message"] = "Aurix can assign the roles shown in the dropdown."

    return cache_set(cache_key, {"roles": assignable_roles, "validation": validation})


def fetch_assignable_roles(guild_id):
    return fetch_role_dashboard_state(guild_id)["roles"]


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
    return_to = request.args.get("return_to", "").strip() or os.environ.get("FRONTEND_URL", "/")
    state = create_oauth_state(return_to)
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
    state_record = consume_oauth_state(state) if state else {}

    if not code:
        return send_from_directory(".", "index.html")

    if not state:
        print("Discord login failed: callback missing state")
        return "Discord login failed: missing state.", 400

    if state != expected_state and not state_record:
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
    dashboard_token = create_dashboard_session(session["discord_user"], token["access_token"])

    frontend_url = state_record.get("returnTo") or os.environ.get("FRONTEND_URL", "/")
    user_query = urlencode({
        "discord_login": "1",
        "discord_user": json.dumps(session["discord_user"], separators=(",", ":")),
        "dashboard_token": dashboard_token,
    })
    separator = "&" if "?" in frontend_url else "?"
    return redirect(f"{frontend_url}{separator}{user_query}")


@app.route("/logout", methods=["POST", "OPTIONS"])
def logout():
    if request.method == "OPTIONS":
        return "", 204

    session.pop("discord_user", None)
    session.pop("discord_access_token", None)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        dashboard_sessions_collection().delete_one({"tokenHash": hash_dashboard_token(auth_header.removeprefix("Bearer ").strip())})
    return jsonify({"ok": True})


@app.route("/api/me")
def current_user():
    user = session.get("discord_user")
    if not user:
        return jsonify({"user": None, "authenticated": False}), 401

    return jsonify({"user": user, "authenticated": True})


@app.route("/api/status")
def api_status():
    configured_latency = os.environ.get("BOT_LATENCY_MS", "").strip()
    try:
        latency_ms = int(configured_latency) if configured_latency else None
    except ValueError:
        latency_ms = None

    return jsonify({
        "online": True,
        "latencyMs": latency_ms,
        "checkedAt": datetime.utcnow().isoformat() + "Z",
    })


@app.route("/api/community-data")
def api_community_data():
    try:
        payload = build_live_community_data()
    except (RuntimeError, ConfigurationError):
        return jsonify({"error": "Live community data is not configured."}), 503

    response = jsonify(payload)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/api/dashboard/guilds")
def dashboard_guilds():
    _user, access_token, error = require_dashboard_auth()
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
    _user, access_token, error = require_dashboard_auth()
    if error:
        return error
    if not get_manageable_guild(access_token, guild_id):
        return jsonify({"error": "You need Manage Server or Administrator for this server."}), 403

    try:
        state = fetch_role_dashboard_state(guild_id)
        return jsonify({
            "roles": sorted(state["roles"], key=lambda role: role["position"], reverse=True),
            "validation": state["validation"],
        })
    except HTTPError as error:
        return jsonify({"error": f"Aurix could not load roles for this server. Make sure the bot is in the server. HTTP {error.code}."}), 502
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 500


@app.route("/api/dashboard/guilds/<guild_id>/role-listings", methods=["GET", "POST", "OPTIONS"])
def dashboard_role_listings(guild_id):
    if request.method == "OPTIONS":
        return "", 204

    user, access_token, error = require_dashboard_auth()
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
    description = str(payload.get("description", "")).strip()[:300]
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

    _user, access_token, error = require_dashboard_auth()
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


@app.route("/api/dashboard/role-listings/<listing_id>", methods=["DELETE", "OPTIONS"])
def dashboard_delete_role_listing(listing_id):
    if request.method == "OPTIONS":
        return "", 204

    _user, access_token, error = require_dashboard_auth()
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

    collection.delete_one({"_id": object_id})
    return jsonify({"ok": True})


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
