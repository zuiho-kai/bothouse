"""Tiny stand-in for the Discord REST API, for `bothouse setup apply` in CI (CONEST_DISCORD_API_BASE).

Serves the four calls setup apply makes (same answers as fakeDiscord in
bridge/core/setup_wizard_test.go): one bot, token "MTEx.ci.fake" (bot id 111), in guild 900,
Message Content Intent on, owner 777. Any other token gets 401. Usage: fake_discord.py <port>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = "MTEx.ci.fake"
ROUTES = {
    "/users/@me": {"id": "111", "username": "cibot", "bot": True},
    "/oauth2/applications/@me": {"id": "111", "flags": 1 << 18, "owner": {"id": "777"}},
    "/users/@me/guilds": [{"id": "900", "name": "Home"}],
    "/guilds/900/channels": [{"id": "1", "name": "general", "type": 0, "position": 1}],
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get("Authorization", "").removeprefix("Bot ") != TOKEN:
            self.send_response(401)
            self.end_headers()
            return
        body = ROUTES.get(self.path.split("?")[0])
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
