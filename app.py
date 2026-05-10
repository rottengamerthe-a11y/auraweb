import os
import secrets
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json

from flask import Flask, jsonify, redirect, request, send_from_directory, session

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-session-secret-change-me")

DISCORD_API_BASE = "https://discord.com/api/v10"
DISCORD_REQUEST_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "AurixWebsiteOAuth/1.0 (https://aurawebsite-12gd.onrender.com)",
}


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


def exchange_discord_code(code):
    data = urlencode({
        "client_id": require_env("DISCORD_CLIENT_ID"),
        "client_secret": require_env("DISCORD_CLIENT_SECRET"),
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": require_env("DISCORD_REDIRECT_URI"),
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
    redirect_uri = os.environ.get("DISCORD_REDIRECT_URI", "").strip()
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
        "redirect_uri": require_env("DISCORD_REDIRECT_URI"),
        "response_type": "code",
        "scope": "identify",
        "state": state,
    }

    return redirect(f"https://discord.com/oauth2/authorize?{urlencode(params)}")


@app.route("/auth/discord/callback")
def discord_callback():
    code = request.args.get("code", "")
    state = request.args.get("state", "")
    expected_state = session.get("discord_oauth_state")

    if not code:
        print("Discord login failed: callback missing code")
        return "Discord login failed: missing code.", 400

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

    return redirect(os.environ.get("FRONTEND_URL", "/"))


@app.route("/logout", methods=["POST", "OPTIONS"])
def logout():
    if request.method == "OPTIONS":
        return "", 204

    session.pop("discord_user", None)
    return jsonify({"ok": True})


@app.route("/api/me")
def current_user():
    user = session.get("discord_user")
    if not user:
        return jsonify({"user": None, "authenticated": False}), 401

    return jsonify({"user": user, "authenticated": True})


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
