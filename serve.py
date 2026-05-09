#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os

class MyHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add Content Security Policy header that allows Paddle iframe
        self.send_header('Content-Security-Policy', 
                        "frame-ancestors 'self' https://sandbox-buy.paddle.com https://buy.paddle.com; "
                        "default-src 'self' https: data:; "
                        "script-src 'self' https://cdn.paddle.com 'unsafe-inline' 'unsafe-eval'; "
                        "style-src 'self' https: 'unsafe-inline'; "
                        "connect-src 'self' https: wss:; "
                        "font-src 'self' https: data:;")
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
    
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format%args}")

if __name__ == '__main__':
    os.chdir(r'd:\auraweb-main')
    server = HTTPServer(('127.0.0.1', 8000), MyHTTPRequestHandler)
    print('Server running at http://localhost:8000')
    print('Press Ctrl+C to stop')
    server.serve_forever()
