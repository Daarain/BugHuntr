from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv
from pdf2image import convert_from_path
import tempfile
import re
from datetime import datetime
from difflib import SequenceMatcher
import json
from PIL import Image
from PIL.ExifTags import TAGS
import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.util import connection as urllib3_connection
import base64
import mimetypes
import urllib.parse
import socket
import ipaddress
from groq import Groq
import uuid
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__)
CORS(
	app,
	resources={
		r"/api/*": {
			"origins": [
				"http://localhost:3000",
				"http://localhost:3001",
				"https://bug-huntr-eight.vercel.app",
			]
		}
	},
)

# -------------------------
# OCR Setup (lazy initialization)
# -------------------------
_ocr = None


def get_ocr():
	global _ocr
	if _ocr is None:
		from paddleocr import PaddleOCR
		_ocr = PaddleOCR(
			use_doc_orientation_classify=False,
			use_doc_unwarping=False,
			use_textline_orientation=False,
			lang="en",
		)
	return _ocr

# -------------------------
# Allowed file extensions
# -------------------------
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "pdf", "webp"}

# -------------------------
# Configuration
# -------------------------
MAX_IMAGE_AGE_DAYS = 30  # Screenshots should be recent
MIN_SIMILARITY_THRESHOLD = 0.4  # Minimum similarity between description and OCR text

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

# Common error indicators to help identify error regions
COMMON_ERROR_INDICATORS = [
	"error",
	"exception",
	"failed",
	"failure",
	"warning",
	"alert",
	"undefined",
	"null",
	"cannot",
	"unable",
	"not found",
	"404",
	"500",
	"403",
	"401",
	"forbidden",
	"unauthorized",
	"timeout",
	"crash",
	"bug",
	"issue",
	"problem",
	"invalid",
	"incorrect",
	"unexpected",
	"denied",
	"rejected",
	"missing",
]

# Common deployment/hosting indicators that should count as strong evidence.
DEPLOYMENT_INDICATORS = [
	"404",
	"not found",
	"not_found",
	"vercel",
	"deployment",
	"build",
	"project root",
	"entry point",
	"index.html",
	"pages/index",
	"app/page",
]


# -------------------------
# OCR Helper Functions
# -------------------------
def extract_text_from_image(image_path):
	"""Extract text using PaddleOCR predict method"""
	try:
		result = get_ocr().predict(image_path)

		if not result:
			return ""

		all_text = []
		for page_result in result:
			result_json = page_result.json
			ocr_data = result_json.get("res", {})

			rec_texts = ocr_data.get("rec_texts", [])
			rec_scores = ocr_data.get("rec_scores", [])

			for text, score in zip(rec_texts, rec_scores):
				if text and text.strip() and score > 0.3:
					clean_text = text.strip()
					all_text.append(clean_text)

		extracted_text = "\n".join(all_text)
		return extracted_text

	except Exception:
		return ""


def extract_image_metadata(image_path):
	"""Extract EXIF metadata from image to check timestamp and authenticity"""
	try:
		image = Image.open(image_path)
		exif_data = {}

		exif = image._getexif()
		if exif:
			for tag_id, value in exif.items():
				tag = TAGS.get(tag_id, tag_id)
				exif_data[tag] = value

		timestamp = None
		timestamp_fields = ["DateTime", "DateTimeOriginal", "DateTimeDigitized"]

		for field in timestamp_fields:
			if field in exif_data:
				try:
					timestamp = datetime.strptime(str(exif_data[field]), "%Y:%m:%d %H:%M:%S")
					break
				except Exception:
					pass

		if not timestamp:
			timestamp = datetime.fromtimestamp(os.path.getmtime(image_path))

		return {
			"timestamp": timestamp,
			"exif_data": exif_data,
			"has_exif": bool(exif),
			"image_size": image.size,
			"image_mode": image.mode,
		}

	except Exception:
		return {
			"timestamp": datetime.fromtimestamp(os.path.getmtime(image_path)),
			"exif_data": {},
			"has_exif": False,
		}


def extract_timestamps_from_text(text):
	"""Extract any timestamps found in the OCR text"""
	timestamps = []

	patterns = [
		r"(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2})",
		r"(\d{2}[-/]\d{2}[-/]\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))",
		r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})",
		r"(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)",
		r"\b(1[0-9]{9})\b",
	]

	for pattern in patterns:
		matches = re.findall(pattern, text)
		timestamps.extend(matches)

	return timestamps


def calculate_similarity(text1, text2):
	"""Calculate similarity between two text strings using SequenceMatcher"""
	text1 = text1.lower().strip()
	text2 = text2.lower().strip()
	return SequenceMatcher(None, text1, text2).ratio()


def extract_keywords_from_description(description):
	"""Extract meaningful keywords from bug description for matching"""
	desc_lower = description.lower()

	stop_words = {
		"the",
		"a",
		"an",
		"and",
		"or",
		"but",
		"in",
		"on",
		"at",
		"to",
		"for",
		"of",
		"with",
		"by",
		"from",
		"as",
		"is",
		"was",
		"are",
		"been",
		"be",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"will",
		"would",
		"should",
		"could",
		"may",
		"might",
		"can",
		"this",
		"that",
		"these",
		"those",
		"i",
		"you",
		"he",
		"she",
		"it",
		"we",
		"they",
		"them",
		"their",
		"my",
		"your",
		"when",
		"where",
		"why",
		"how",
		"which",
		"who",
		"what",
	}

	words = re.findall(r"\b\w+\b", desc_lower)
	keywords = [word for word in words if len(word) >= 3 and word not in stop_words]

	quoted_phrases = re.findall(r"[\"\']([^\"\']+)[\"\']", description)

	error_patterns = re.findall(r"\b\d{3}\b", description)

	return {
		"keywords": list(set(keywords)),
		"quoted_phrases": quoted_phrases,
		"error_codes": error_patterns,
	}


def find_error_messages(text, description):
	"""Find error messages in screenshot that match keywords from description"""
	error_messages = []
	lines = text.split("\n")

	extracted = extract_keywords_from_description(description)
	keywords = extracted["keywords"]
	quoted_phrases = extracted["quoted_phrases"]
	error_codes = extracted["error_codes"]

	text_lower = text.lower()

	for phrase in quoted_phrases:
		phrase_lower = phrase.lower()
		if phrase_lower in text_lower:
			for i, line in enumerate(lines):
				if phrase_lower in line.lower():
					context_lines = lines[max(0, i - 1) : min(i + 3, len(lines))]
					error_msg = " ".join(context_lines).strip()
					error_messages.append(
						{
							"message": error_msg,
							"matched_term": phrase,
							"match_type": "exact_phrase",
							"line_number": i + 1,
							"confidence": 1.0,
						}
					)
					break

	for code in error_codes:
		if code in text:
			for i, line in enumerate(lines):
				if code in line:
					context_lines = lines[max(0, i - 1) : min(i + 3, len(lines))]
					error_msg = " ".join(context_lines).strip()

					if not any(err["message"] == error_msg for err in error_messages):
						error_messages.append(
							{
								"message": error_msg,
								"matched_term": code,
								"match_type": "error_code",
								"line_number": i + 1,
								"confidence": 0.9,
							}
						)
					break

	for i, line in enumerate(lines):
		line_lower = line.lower()

		matched_keywords = [kw for kw in keywords if kw in line_lower]

		if matched_keywords:
			has_error_indicator = any(indicator in line_lower for indicator in COMMON_ERROR_INDICATORS)

			if has_error_indicator or len(matched_keywords) >= 2:
				context_lines = lines[max(0, i - 1) : min(i + 3, len(lines))]
				error_msg = " ".join(context_lines).strip()

				if not any(err["message"] == error_msg for err in error_messages):
					confidence = 0.7 if has_error_indicator else 0.5
					confidence += min(len(matched_keywords) * 0.1, 0.3)

					error_messages.append(
						{
							"message": error_msg,
							"matched_term": ", ".join(matched_keywords[:3]),
							"match_type": "keyword_match",
							"line_number": i + 1,
							"confidence": min(confidence, 1.0),
						}
					)

	error_messages.sort(key=lambda x: x["confidence"], reverse=True)

	return error_messages[:10]


def check_description_match(description, ocr_text):
	"""Check if bug description matches content found in screenshot"""
	description_lower = description.lower()
	ocr_lower = ocr_text.lower()

	desc_words = [word for word in re.findall(r"\b\w+\b", description_lower) if len(word) > 3]

	matches = sum(1 for word in desc_words if word in ocr_lower)
	match_percentage = (matches / len(desc_words) * 100) if desc_words else 0

	overall_similarity = calculate_similarity(description, ocr_text)

	return {
		"match_percentage": match_percentage,
		"overall_similarity": overall_similarity,
		"matched_words": matches,
		"total_words": len(desc_words),
	}


def indicator_overlap(description, ocr_text):
	"""Check for overlapping deployment/error indicators between description and OCR text."""
	desc_lower = description.lower()
	ocr_lower = ocr_text.lower()
	matched = [term for term in DEPLOYMENT_INDICATORS if term in desc_lower and term in ocr_lower]
	return {
		"matched_terms": matched,
		"count": len(matched),
	}


def verify_image_freshness(metadata, max_age_days=MAX_IMAGE_AGE_DAYS):
	"""Verify that the image is recent and not reused from old reports"""
	timestamp = metadata.get("timestamp")

	if not timestamp:
		return {"is_fresh": False, "reason": "No timestamp found", "age_days": None}

	now = datetime.now()
	age = now - timestamp
	age_days = age.days

	is_fresh = age_days <= max_age_days

	return {
		"is_fresh": is_fresh,
		"timestamp": timestamp.isoformat(),
		"age_days": age_days,
		"reason": f"Image is {age_days} days old" if not is_fresh else "Image is recent",
	}


def is_allowed_file(filename):
	"""Check if file extension is allowed"""
	return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024  # 10MB limit
ALLOWED_MIME_TYPES = {
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"application/pdf",
}


def is_safe_ip(ip_str):
	"""Check if an IP address string is a safe, publicly routable address."""
	try:
		ip = ipaddress.ip_address(ip_str)
		# Unwrap IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
		if getattr(ip, "ipv4_mapped", None):
			ip = ip.ipv4_mapped
		if (
			ip.is_loopback
			or ip.is_private
			or ip.is_link_local
			or ip.is_multicast
			or ip.is_reserved
			or ip.is_unspecified
		):
			return False
		# Check explicit cloud metadata and special range addresses
		if str(ip) in {"169.254.169.254", "169.254.170.2", "fd00:ec2::254"}:
			return False
		return True
	except ValueError:
		return False


class PinnedIPAdapter(HTTPAdapter):
	"""
	Transport adapter that pins socket connections directly to a validated IP address.
	Eliminates Time-of-Check to Time-of-Use (TOCTOU) DNS rebinding vulnerabilities
	while preserving SNI, TLS handshake, and certificate hostname verification.
	"""
	def __init__(self, pinned_ip, *args, **kwargs):
		self.pinned_ip = pinned_ip
		super().__init__(*args, **kwargs)

	def _patch_connection_pool(self, conn):
		pinned_ip = self.pinned_ip

		class SpecificHTTPSConnection(HTTPSConnection):
			def _new_conn(self):
				return urllib3_connection.create_connection(
					(pinned_ip, self.port),
					self.timeout,
					source_address=self.source_address,
					socket_options=self.socket_options,
				)

		class SpecificHTTPConnection(HTTPConnection):
			def _new_conn(self):
				return urllib3_connection.create_connection(
					(pinned_ip, self.port),
					self.timeout,
					source_address=self.source_address,
					socket_options=self.socket_options,
				)

		if isinstance(conn, HTTPSConnectionPool):
			conn.ConnectionCls = SpecificHTTPSConnection
		else:
			conn.ConnectionCls = SpecificHTTPConnection
		return conn

	def get_connection(self, url, proxies=None):
		conn = super().get_connection(url, proxies=proxies)
		return self._patch_connection_pool(conn)

	def get_connection_with_tls_context(self, request, verify, proxies=None, cert=None):
		conn = super().get_connection_with_tls_context(request, verify, proxies=proxies, cert=cert)
		return self._patch_connection_pool(conn)


def validate_remote_url(url):
	"""Validate that a URL uses http/https and resolves only to safe public IPs. Returns (parsed_url, pinned_ip)."""
	parsed = urllib.parse.urlparse(url)
	if parsed.scheme.lower() not in ("http", "https"):
		raise ValueError(f"Unsupported scheme '{parsed.scheme}'. Only HTTP and HTTPS are allowed.")

	hostname = parsed.hostname
	if not hostname:
		raise ValueError("Invalid URL: hostname is required.")

	# Check if hostname itself is an IP literal
	try:
		ip = ipaddress.ip_address(hostname)
		if not is_safe_ip(str(ip)):
			raise ValueError(f"Restricted IP address target: {hostname}")
		return parsed, str(ip)
	except ValueError:
		# Hostname is a domain name, resolve via DNS
		pass

	port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
	try:
		addr_info = socket.getaddrinfo(hostname, port, family=socket.AF_UNSPEC, proto=socket.IPPROTO_TCP)
	except socket.gaierror as e:
		raise ValueError(f"DNS resolution failed for hostname '{hostname}': {e}")

	if not addr_info:
		raise ValueError(f"No IP addresses resolved for hostname '{hostname}'.")

	resolved_ips = []
	for entry in addr_info:
		resolved_ip = entry[4][0]
		if not is_safe_ip(resolved_ip):
			raise ValueError(f"Access to resolved IP '{resolved_ip}' is restricted.")
		resolved_ips.append(resolved_ip)

	return parsed, resolved_ips[0]


def validate_magic_bytes(data):
	"""Verify data starts with allowed image or PDF signatures."""
	if data.startswith(b"\x89PNG\r\n\x1a\n"):
		return "png"
	if data.startswith(b"\xff\xd8\xff"):
		return "jpg"
	if data.startswith(b"%PDF"):
		return "pdf"
	if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
		return "webp"
	return None


def _download_to_temp(url, temp_dir):
	"""Securely download a URL or data URL to a temp file with SSRF and DNS rebinding mitigations."""
	if not url or not isinstance(url, str):
		raise ValueError("Invalid screenshot URL")

	url = url.strip()

	if url.startswith("data:"):
		match = re.match(
			r"^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,(.+)$",
			url,
			re.IGNORECASE | re.DOTALL,
		)
		if not match:
			raise ValueError("Invalid or disallowed data URL format.")

		mime = match.group(1).lower()
		b64_data = match.group(2)
		if len(b64_data) > MAX_DOWNLOAD_BYTES * 2:
			raise ValueError("Data URL payload exceeds maximum allowed size.")

		try:
			decoded_bytes = base64.b64decode(b64_data, validate=True)
		except Exception as e:
			raise ValueError(f"Invalid base64 payload in data URL: {e}")

		if len(decoded_bytes) > MAX_DOWNLOAD_BYTES:
			raise ValueError("Decoded file exceeds maximum size limit of 10MB.")

		detected_ext = validate_magic_bytes(decoded_bytes)
		if not detected_ext:
			raise ValueError("Data URL content magic bytes do not match allowed image or PDF types.")

		filename = f"upload.{detected_ext}"
		file_path = os.path.join(temp_dir, filename)
		with open(file_path, "wb") as f:
			f.write(decoded_bytes)
		return file_path, filename

	# Validate remote URL and DNS resolution against SSRF, obtaining pinned IP
	parsed, pinned_ip = validate_remote_url(url)

	session = requests.Session()
	session.trust_env = False  # Ignore system proxies (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY)
	adapter = PinnedIPAdapter(pinned_ip)
	session.mount("https://", adapter)
	session.mount("http://", adapter)

	# Fetch with redirects disabled and strict timeouts using pinned transport
	try:
		response = session.get(
			url,
			timeout=(5, 10),
			allow_redirects=False,
			stream=True,
			headers={"User-Agent": "BugHuntr-Security-Scanner/1.0"},
		)
	except requests.RequestException as e:
		raise ValueError(f"Failed to fetch remote screenshot: {e}")

	if response.status_code in (301, 302, 303, 307, 308):
		raise ValueError("Redirects are disallowed for security.")

	if response.status_code != 200:
		raise ValueError(f"Remote server returned HTTP {response.status_code}.")

	# Verify Content-Type
	content_type_header = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
	if content_type_header and content_type_header not in ALLOWED_MIME_TYPES:
		raise ValueError(f"Disallowed Content-Type '{content_type_header}'.")

	# Enforce size limits via Content-Length if present
	content_length = response.headers.get("Content-Length")
	if content_length and content_length.isdigit() and int(content_length) > MAX_DOWNLOAD_BYTES:
		raise ValueError("Content-Length exceeds maximum allowed size of 10MB.")

	# Stream download and enforce byte limit
	downloaded_bytes = bytearray()
	for chunk in response.iter_content(chunk_size=65536):
		if chunk:
			downloaded_bytes.extend(chunk)
			if len(downloaded_bytes) > MAX_DOWNLOAD_BYTES:
				raise ValueError("Downloaded file exceeds maximum allowed size of 10MB.")

	if len(downloaded_bytes) == 0:
		raise ValueError("Downloaded file is empty.")

	# Validate magic bytes
	detected_ext = validate_magic_bytes(bytes(downloaded_bytes[:64]))
	if not detected_ext:
		raise ValueError("Downloaded file does not match allowed signatures (PNG, JPEG, PDF, WEBP).")

	filename = f"download.{detected_ext}"
	file_path = os.path.join(temp_dir, filename)
	with open(file_path, "wb") as f:
		f.write(downloaded_bytes)

	return file_path, filename


def llm_description_match(description, ocr_text):
	"""Use Groq to assess whether OCR text supports the description."""
	if not groq_client:
		return {"score": None, "verdict": "unknown", "explanation": "GROQ_API_KEY not set"}

	prompt = (
		"You are validating whether a bug description matches OCR text extracted from a screenshot. "
		"Return strict JSON with keys: verdict (match|partial|mismatch), score (0-1), explanation. "
		"Be conservative and base your judgment only on provided text.\n\n"
		f"Description:\n{description}\n\nOCR Text (truncated):\n{ocr_text[:2000]}"
	)

	try:
		completion = groq_client.chat.completions.create(
			model="llama-3.1-8b-instant",
			messages=[{"role": "user", "content": prompt}],
			temperature=0.0,
			max_tokens=200,
		)
		raw = completion.choices[0].message.content.strip()
		json_match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
		payload = json.loads(json_match.group(0)) if json_match else {}
		verdict = payload.get("verdict", "unknown")
		score = float(payload.get("score", 0)) if payload.get("score") is not None else None
		explanation = payload.get("explanation", "No explanation provided")
		return {"score": score, "verdict": verdict, "explanation": explanation}
	except Exception as exc:
		return {"score": None, "verdict": "unknown", "explanation": f"LLM error: {exc}"}


def _image_to_data_url(image_path):
	"""Encode local image to a data URL for multimodal LLM input."""
	mime_type, _ = mimetypes.guess_type(image_path)
	if not mime_type:
		mime_type = "image/png"

	with open(image_path, "rb") as image_file:
		encoded = base64.b64encode(image_file.read()).decode("utf-8")

	return f"data:{mime_type};base64,{encoded}"


def llm_visual_context_match(description, image_path, ocr_text=""):
	"""Use a multimodal LLM to validate screenshot context against the bug description."""
	if not groq_client:
		return {"score": None, "verdict": "unknown", "explanation": "GROQ_API_KEY not set", "evidence": []}

	if not image_path or not os.path.exists(image_path):
		return {"score": None, "verdict": "unknown", "explanation": "No image provided", "evidence": []}

	try:
		image_data_url = _image_to_data_url(image_path)
	except Exception as exc:
		return {"score": None, "verdict": "unknown", "explanation": f"Image encoding failed: {exc}", "evidence": []}

	prompt = (
		"You are validating whether a screenshot supports a vulnerability report. "
		"Focus on UI evidence too (missing buttons/options/actions counts as valid evidence). "
		"Return strict JSON with keys: verdict (match|partial|mismatch), score (0-1), explanation, evidence (array of short strings).\n\n"
		f"Bug description:\n{description}\n\n"
		f"OCR context (may be incomplete):\n{ocr_text[:1200]}"
	)

	try:
		completion = groq_client.chat.completions.create(
			model=GROQ_VISION_MODEL,
			messages=[
				{
					"role": "user",
					"content": [
						{"type": "text", "text": prompt},
						{"type": "image_url", "image_url": {"url": image_data_url}},
					],
				}
			],
			temperature=0.0,
			max_tokens=350,
		)

		raw = completion.choices[0].message.content.strip()
		json_match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
		payload = json.loads(json_match.group(0)) if json_match else {}

		verdict = payload.get("verdict", "unknown")
		score = float(payload.get("score", 0)) if payload.get("score") is not None else None
		explanation = payload.get("explanation", "No explanation provided")
		evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []

		return {"score": score, "verdict": verdict, "explanation": explanation, "evidence": evidence}
	except Exception as exc:
		return {"score": None, "verdict": "unknown", "explanation": f"Vision LLM error: {exc}", "evidence": []}


def build_fake_report(analysis_result):
	"""Convert analysis details to the UI fake report shape."""
	confidence = analysis_result.get("confidence_score", 0)
	verification_status = analysis_result.get("verification_status")
	llm_match = analysis_result.get("details", {}).get("llm_match", {})

	if verification_status == "failed" or confidence < 35:
		status = "Likely Fake"
	elif confidence < 60:
		status = "Suspicious"
	else:
		status = "Likely Genuine"

	reasons = []
	reasons.extend(analysis_result.get("errors", []))
	reasons.extend(analysis_result.get("warnings", []))
	if llm_match.get("verdict") and llm_match.get("verdict") != "unknown":
		reasons.append(f"LLM match: {llm_match.get('verdict')} - {llm_match.get('explanation')}")

	fake_score = round(max(0, 100 - confidence), 2)

	return {"status": status, "score": fake_score, "reasons": reasons}


# -------------------------
# Bug Screenshot Analysis Endpoint
# -------------------------
@app.route("/api/analyze-bug-screenshot", methods=["POST"])
def analyze_bug_screenshot():
	"""
	Analyze bug screenshot to verify it matches the bug description.

	Accepts either multipart/form-data with a file or JSON with screenshotUrl.
	"""
	try:
		bug_description = ""
		bug_id = ""
		screenshot = None
		screenshot_url = None

		if request.is_json:
			payload = request.get_json(silent=True) or {}
			bug_description = (payload.get("bugDescription") or "").strip()
			bug_id = (payload.get("bugId") or "").strip()
			screenshot_url = (payload.get("screenshotUrl") or "").strip()
		else:
			form = request.form
			bug_description = form.get("bugDescription", "").strip()
			bug_id = form.get("bugId", "").strip()
			screenshot_url = form.get("screenshotUrl", "").strip()
			screenshot = request.files.get("screenshot")

		if not bug_description:
			return jsonify({"error": "Bug description is required"}), 400

		if not screenshot and not screenshot_url:
			return jsonify({"error": "Screenshot file or URL is required"}), 400

		analysis_result = {
			"bug_id": bug_id,
			"verification_status": "pending",
			"errors": [],
			"warnings": [],
			"details": {},
		}

		with tempfile.TemporaryDirectory() as temp_dir:
			visual_context_path = None

			if screenshot:
				raw_name = screenshot.filename or "upload"
				if not is_allowed_file(raw_name):
					return jsonify({"error": f"Unsupported file type: {raw_name}"}), 400
				safe_name = secure_filename(os.path.basename(raw_name))
				if not safe_name or not is_allowed_file(safe_name):
					ext = raw_name.rsplit('.', 1)[1].lower() if '.' in raw_name else 'png'
					safe_name = f"upload_{uuid.uuid4().hex[:8]}.{ext}"
				file_path = os.path.abspath(os.path.join(temp_dir, safe_name))
				if not file_path.startswith(os.path.abspath(temp_dir) + os.sep):
					return jsonify({"error": "Path traversal detected in upload filename."}), 400
				filename = safe_name
				screenshot.save(file_path)
				visual_context_path = file_path
			else:
				file_path, filename = _download_to_temp(screenshot_url, temp_dir)
				if not is_allowed_file(filename):
					return jsonify({"error": f"Unsupported file type: {filename}"}), 400
				visual_context_path = file_path

			metadata = extract_image_metadata(file_path)
			analysis_result["details"]["freshness"] = verify_image_freshness(metadata)

			ext = filename.rsplit(".", 1)[1].lower()
			if ext in ["jpg", "jpeg", "png"]:
				ocr_text = extract_text_from_image(file_path)
			elif ext == "pdf":
				images = convert_from_path(file_path, dpi=300)
				ocr_texts = []
				for i, img in enumerate(images):
					temp_img_path = os.path.join(temp_dir, f"temp_page_{i}.png")
					img.save(temp_img_path, "PNG")
					ocr_texts.append(extract_text_from_image(temp_img_path))
					if i == 0:
						visual_context_path = temp_img_path
				ocr_text = "\n".join(ocr_texts)
			else:
				ocr_text = ""

			analysis_result["details"]["extracted_text"] = ocr_text

			if not ocr_text or len(ocr_text) < 10:
				analysis_result["warnings"].append("Very little or no text found in screenshot")

			error_messages = find_error_messages(ocr_text, bug_description)
			analysis_result["details"]["error_messages"] = error_messages

			ocr_timestamps = extract_timestamps_from_text(ocr_text)
			analysis_result["details"]["ocr_timestamps"] = ocr_timestamps

			match_result = check_description_match(bug_description, ocr_text)
			analysis_result["details"]["description_match"] = match_result

			indicator_result = indicator_overlap(bug_description, ocr_text)
			analysis_result["details"]["indicator_overlap"] = indicator_result

			llm_match = llm_description_match(bug_description, ocr_text)
			analysis_result["details"]["llm_match"] = llm_match

			visual_llm_match = llm_visual_context_match(bug_description, visual_context_path, ocr_text)
			analysis_result["details"]["visual_llm_match"] = visual_llm_match

			visual_supports_bug = (
				visual_llm_match.get("score") is not None
				and visual_llm_match.get("score") >= 0.6
				and visual_llm_match.get("verdict") in ["match", "partial"]
			)

			verification_passed = True

			if match_result["match_percentage"] < 20:
				if indicator_result["count"] > 0 or visual_supports_bug:
					analysis_result["warnings"].append(
						"Low OCR/text match, but context indicators or visual LLM evidence support the report"
					)
				else:
					analysis_result["errors"].append(
						f"Low match between description and screenshot ({match_result['match_percentage']:.1f}%)"
					)
					verification_passed = False
			elif match_result["match_percentage"] < 40:
				analysis_result["warnings"].append(
					f"Moderate match between description and screenshot ({match_result['match_percentage']:.1f}%)"
				)

			high_confidence_errors = [err for err in error_messages if err["confidence"] >= 0.7]

			if not error_messages:
				if visual_supports_bug:
					analysis_result["warnings"].append(
						"No OCR error text found, but visual context supports the described UI issue"
					)
				else:
					analysis_result["warnings"].append("No error messages matching description found in screenshot")
			elif not high_confidence_errors:
				analysis_result["warnings"].append("Error messages found but low confidence match with description")

			freshness = analysis_result["details"]["freshness"]
			if not freshness["is_fresh"]:
				if freshness["age_days"] and freshness["age_days"] > 90:
					analysis_result["errors"].append(
						f"Screenshot is too old ({freshness['age_days']} days)"
					)
					verification_passed = False

			if llm_match.get("score") is not None and llm_match.get("score") < 0.35:
				if indicator_result["count"] == 0 and not visual_supports_bug:
					analysis_result["warnings"].append("LLM indicates weak description match")

			if verification_passed:
				if analysis_result["warnings"]:
					analysis_result["verification_status"] = "verified_with_warnings"
				else:
					analysis_result["verification_status"] = "verified"
			else:
				analysis_result["verification_status"] = "failed"

			error_score = 0
			if error_messages:
				avg_error_confidence = sum(err["confidence"] for err in error_messages) / len(error_messages)
				error_score = avg_error_confidence * 100

			llm_score = (llm_match.get("score") or 0) * 100
			visual_score = (visual_llm_match.get("score") or 0) * 100

			indicator_score = min(indicator_result["count"], 3) * 10
			confidence_score = (
				(match_result["match_percentage"] * 0.2)
				+ (match_result["overall_similarity"] * 100 * 0.15)
				+ (error_score * 0.15)
				+ (100 if freshness["is_fresh"] else 0) * 0.1
				+ (llm_score * 0.1)
				+ (visual_score * 0.25)
				+ indicator_score
			)
			confidence_score = max(0, min(100, confidence_score))
			analysis_result["confidence_score"] = round(confidence_score, 2)

			fake_report = build_fake_report(analysis_result)

			return jsonify(
				{
					"success": True,
					"analysis": analysis_result,
					"fake_report": fake_report,
					"message": f"Analysis complete - {analysis_result['verification_status']}",
				}
			)

	except ValueError as ve:
		return jsonify({"error": f"Invalid screenshot input: {str(ve)}"}), 400
	except Exception as ex:
		return jsonify({"error": f"Analysis failed: {str(ex)}"}), 500


# -------------------------
# Health Check Endpoint
# -------------------------
@app.route("/api/health", methods=["GET"])
def health_check():
	return jsonify({"status": "healthy", "service": "bug-screenshot-analyzer"})


# -------------------------
# Run App
# -------------------------
if __name__ == "__main__":
	app.run(host="0.0.0.0", port=8001, debug=True)
 