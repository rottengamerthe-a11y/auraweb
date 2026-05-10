from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)


@app.route("/")
def home():
    return send_from_directory(".", "index.html")


@app.route("/auth/discord/callback")
def discord_callback():
    return send_from_directory(".", "index.html")


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
