from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)


@app.route("/")
def home():
    return send_from_directory(".", "index.html")


@app.route("/auth/discord")
@app.route("/auth/discord/callback")
@app.route("/logout")
def spa_auth_routes():
    return send_from_directory(".", "index.html")


@app.route("/api/me")
def current_user():
    return jsonify({"user": None, "authenticated": False}), 401


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
