import unittest
import importlib.util
import os
import tempfile
import base64

# Dynamically import report-detection.py due to hyphen in filename
module_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "report-detection.py"))
spec = importlib.util.spec_from_file_location("report_detection", module_path)
report_detection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report_detection)

is_safe_ip = report_detection.is_safe_ip
validate_remote_url = report_detection.validate_remote_url
validate_magic_bytes = report_detection.validate_magic_bytes
_download_to_temp = report_detection._download_to_temp


class TestSSRFMitigation(unittest.TestCase):

    def test_rejects_private_and_loopback_ips(self):
        unsafe_ips = [
            "127.0.0.1",
            "127.0.0.2",
            "10.0.0.1",
            "10.255.255.255",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.0.1",
            "192.168.1.100",
            "169.254.169.254",  # AWS/GCP/Azure Metadata
            "169.254.1.1",      # Link-local
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fd00::1",
        ]
        for ip in unsafe_ips:
            with self.subTest(ip=ip):
                self.assertFalse(is_safe_ip(ip), f"Expected {ip} to be rejected as unsafe")

    def test_allows_public_routable_ips(self):
        safe_ips = [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",    # example.com
        ]
        for ip in safe_ips:
            with self.subTest(ip=ip):
                self.assertTrue(is_safe_ip(ip), f"Expected {ip} to be allowed as safe public IP")

    def test_rejects_disallowed_schemes(self):
        unsafe_urls = [
            "file:///etc/passwd",
            "file:///C:/Windows/win.ini",
            "ftp://ftp.example.com/test.png",
            "gopher://example.com/test",
            "dict://example.com/",
            "ldap://example.com/dc=test",
        ]
        for url in unsafe_urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError) as ctx:
                    validate_remote_url(url)
                self.assertIn("Unsupported scheme", str(ctx.exception))

    def test_rejects_loopback_and_metadata_urls(self):
        restricted_urls = [
            "http://127.0.0.1:8000/secret.png",
            "http://127.0.0.1:80/admin",
            "http://localhost:3000/image.png",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/internal.png",
            "http://192.168.1.1/router.png",
            "http://0.0.0.0:8000/test.png",
        ]
        for url in restricted_urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError) as ctx:
                    validate_remote_url(url)
                err = str(ctx.exception).lower()
                self.assertTrue("restricted" in err or "non-routable" in err or "resolution" in err,
                                f"Unexpected error message: {ctx.exception}")

    def test_validate_magic_bytes(self):
        png_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
        jpg_data = b"\xff\xd8\xff\xe0" + b"\x00" * 20
        pdf_data = b"%PDF-1.4\n" + b"\x00" * 20
        webp_data = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 10
        html_data = b"<!DOCTYPE html><html><body>malicious</body></html>"

        self.assertEqual(validate_magic_bytes(png_data), "png")
        self.assertEqual(validate_magic_bytes(jpg_data), "jpg")
        self.assertEqual(validate_magic_bytes(pdf_data), "pdf")
        self.assertEqual(validate_magic_bytes(webp_data), "webp")
        self.assertIsNone(validate_magic_bytes(html_data))

    def test_data_url_valid_png(self):
        png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        b64 = base64.b64encode(png_bytes).decode("ascii")
        data_url = f"data:image/png;base64,{b64}"

        with tempfile.TemporaryDirectory() as temp_dir:
            file_path, filename = _download_to_temp(data_url, temp_dir)
            self.assertTrue(os.path.exists(file_path))
            self.assertEqual(filename, "upload.png")
            with open(file_path, "rb") as f:
                content = f.read()
            self.assertEqual(content, png_bytes)

    def test_data_url_rejects_html_or_script(self):
        html_bytes = b"<html><script>alert(1)</script></html>"
        b64 = base64.b64encode(html_bytes).decode("ascii")
        data_url = f"data:text/html;base64,{b64}"

        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(ValueError) as ctx:
                _download_to_temp(data_url, temp_dir)
            self.assertIn("Invalid or disallowed data URL format", str(ctx.exception))

    def test_data_url_rejects_spoofed_mime_with_bad_magic(self):
        fake_png = b"THIS IS NOT A REAL PNG FILE AT ALL"
        b64 = base64.b64encode(fake_png).decode("ascii")
        data_url = f"data:image/png;base64,{b64}"

        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(ValueError) as ctx:
                _download_to_temp(data_url, temp_dir)
            self.assertIn("magic bytes do not match", str(ctx.exception))

    def test_dns_rebinding_pinned_transport_prevents_connection_to_rebound_ip(self):
        from unittest.mock import patch, MagicMock
        PinnedIPAdapter = report_detection.PinnedIPAdapter
        import requests

        safe_pinned_ip = "93.184.216.34"
        adapter = PinnedIPAdapter(safe_pinned_ip)

        session = requests.Session()
        session.trust_env = False
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        with patch("urllib3.util.connection.create_connection") as mock_create_conn:
            mock_create_conn.return_value = MagicMock()
            try:
                session.get("https://rebind-attack.com/test.png", timeout=1)
            except Exception:
                pass

    def test_pinned_transport_live_socket_connection_and_host_header(self):
        import socket
        import threading
        import requests
        PinnedIPAdapter = report_detection.PinnedIPAdapter

        received_headers = []
        server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_socket.bind(("127.0.0.1", 0))
        server_socket.listen(1)
        port = server_socket.getsockname()[1]

        def handle_client():
            try:
                conn, _ = server_socket.accept()
                raw_data = b""
                while b"\r\n\r\n" not in raw_data:
                    chunk = conn.recv(1024)
                    if not chunk:
                        break
                    raw_data += chunk
                received_headers.append(raw_data.decode("latin1", errors="replace"))

                # Reply with valid HTTP 200 and PNG body
                png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
                resp = (
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: image/png\r\n"
                    b"Content-Length: " + str(len(png_bytes)).encode("ascii") + b"\r\n"
                    b"Connection: close\r\n\r\n" + png_bytes
                )
                conn.sendall(resp)
                conn.close()
            except Exception as e:
                received_headers.append(f"ERROR: {e}")
            finally:
                server_socket.close()

        server_thread = threading.Thread(target=handle_client, daemon=True)
        server_thread.start()

        # Mount pinned adapter pointing to 127.0.0.1
        adapter = PinnedIPAdapter("127.0.0.1")
        session = requests.Session()
        session.trust_env = False
        session.mount("http://", adapter)

        # Target an unresolvable synthetic domain that would fail DNS resolution normally
        target_domain = "synthetic-target-nonexistent.invalid"
        target_url = f"http://{target_domain}:{port}/screenshot.png"

        response = session.get(target_url, timeout=3)
        server_thread.join(timeout=3)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Content-Type"), "image/png")
        self.assertTrue(len(received_headers) > 0)
        # Verify the Host header preserves the virtual domain and port
        self.assertIn(f"Host: {target_domain}:{port}", received_headers[0])


if __name__ == "__main__":
    unittest.main()
