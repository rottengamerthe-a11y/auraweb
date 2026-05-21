#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os

class MyHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Local preview headers roughly match the Flask app's production headers.
        self.send_header('Content-Security-Policy', 
                        "default-src 'self'; "
                        "base-uri 'self'; "
                        "object-src 'none'; "
                        "frame-ancestors 'none'; "
                        "script-src 'self' https://cdn.paddle.com 'unsafe-inline'; "
                        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
                        "connect-src 'self' https://discord.com https://*.paddle.com; "
                        "font-src 'self' https://fonts.gstatic.com data:; "
                        "img-src 'self' https://cdn.discordapp.com data:; "
                        "frame-src https://sandbox-buy.paddle.com https://buy.paddle.com;")
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
        super().end_headers()
    
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format%args}")

if __name__ == '__main__':
    os.chdir(r'd:\auraweb-main')
    server = HTTPServer(('127.0.0.1', 8000), MyHTTPRequestHandler)
    print('Server running at http://localhost:8000')
    print('Press Ctrl+C to stop')
    server.serve_forever()
