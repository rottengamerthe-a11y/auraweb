import os
import secrets
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json

from flask import Flask, jsonify, redirect, request, send_from_directory, session

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-session-secret-change-me")

DISCORD_API_BASE = "https://discord.com/api"


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
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    with urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_discord_user(access_token):
    req = Request(
        f"{DISCORD_API_BASE}/users/@me",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    with urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


@app.route("/")
def home():
    return send_from_directory(".", "index.html")


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

    if not code or not state or state != session.get("discord_oauth_state"):
        return "Discord login failed. Please try again.", 400

    session.pop("discord_oauth_state", None)

    try:
        token = exchange_discord_code(code)
        user = fetch_discord_user(token["access_token"])
    except (HTTPError, URLError, KeyError, RuntimeError) as error:
        print(f"Discord login failed: {error}")
        return "Discord login failed. Please try again.", 500

    session["discord_user"] = {
        "id": user["id"],
        "username": user["username"],
        "global_name": user.get("global_name"),
        "avatar": user.get("avatar"),
    }

    return redirect("/")


@app.route("/logout", methods=["POST"])
def logout():
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
    app.run(debug=True)
