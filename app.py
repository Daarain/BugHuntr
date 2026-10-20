from flask import Flask, make_response, request, jsonify
from pydantic import BaseModel, ValidationError
from groq import AsyncGroq
import asyncio
import os
import logging
from flask_cors import CORS
import re
from typing import Tuple
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
# CORS(app, origins=["http://localhost:3000", "https://bug-huntr-eight.vercel.app"])
CORS(
    app,
    resources={r"/api/*": {"origins": ["http://localhost:3000","http://localhost:3001", "https://bug-huntr-eight.vercel.app"]}},
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "OPTIONS"]
)

ALLOWED_CORS_ORIGINS = {
    "http://localhost:3000",
    "http://localhost:3001",
    "https://bug-huntr-eight.vercel.app",
}

@app.before_request
def handle_options():
    # Respond to preflight OPTIONS early and with strictly validated origin
    if request.method == "OPTIONS":
        resp = make_response()
        resp.status_code = 204
        origin = request.headers.get("Origin")
        if origin and origin in ALLOWED_CORS_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return resp

@app.after_request
def add_cors(response):
    # Ensure all responses include the necessary CORS headers
    origin = request.headers.get("Origin")
    if origin and origin in ("http://localhost:3000", "http://localhost:3001", "https://bug-huntr-eight.vercel.app"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# -------------------------
# Fake report evaluation & heuristic helpers
# -------------------------
def _extract_ocr_text(screenshot_path: str) -> str:
    return ""

def _text_similarity(desc: str, ocr_text: str) -> float:
    from difflib import SequenceMatcher
    return SequenceMatcher(None, desc.lower(), ocr_text.lower()).ratio()

def _compute_ela_score(screenshot_path: str) -> float:
    return 0.0

def _severity_inconsistent(title: str, desc: str, severity: str) -> bool:
    return False

def evaluate_fake_report(title: str, desc: str, severity: str, screenshot_path: str = None) -> dict:
    if not screenshot_path:
        return {
            "status": "Likely Genuine",
            "score": 0,
            "reasons": []
        }

    score = 0
    reasons = []

    ocr_text = _extract_ocr_text(screenshot_path)
    sim = _text_similarity(desc, ocr_text)
    if sim < 0.2:
        score += 30
        reasons.append("Screenshot text does not match description")

    ela = _compute_ela_score(screenshot_path)
    if ela > 0.2:
        score += 40
        reasons.append("Screenshot shows signs of manipulation")

    if _severity_inconsistent(title, desc, severity):
        score += 30
        reasons.append("Severity claim inconsistent with evidence")

    if score >= 70:
        status = "Likely Fake"
    elif score >= 50:
        status = "Suspicious"
    else:
        status = "Likely Genuine"

    return {
        "status": status,
        "score": score,
        "reasons": reasons
    }

class BugReport(BaseModel):
    title: str
    description: str

@app.route("/", methods=["GET"])
def root():
    return jsonify({"message": "API is running"})

# -------------------------
# Deterministic rule classifier
# -------------------------
def _tokenize(text: str) -> list:
    # Normalize to alphanumeric tokens to avoid substring false-positives (e.g., "rce" in "force").
    return re.findall(r"[a-z0-9]+", text.lower())


def _contains_phrase(text: str, phrase: str) -> bool:
    # Phrase-level match with word boundaries when possible.
    pattern = r"\b" + re.escape(phrase.lower()) + r"\b"
    return re.search(pattern, text) is not None


def _has_negated_phrase(text: str, phrase: str, negations: list) -> bool:
    # Detect nearby negations like "no", "not", "without" within a small window before phrase.
    window = 32
    for match in re.finditer(re.escape(phrase.lower()), text):
        start = max(0, match.start() - window)
        prefix = text[start:match.start()]
        if any(re.search(r"\b" + re.escape(n) + r"\b", prefix) for n in negations):
            return True
    return False


def classify_with_rules(title: str, desc: str) -> Tuple[str, str]:
    s = (title + " " + desc).lower()
    tokens = set(_tokenize(s))

    # Negation terms used to suppress catastrophic matches when explicitly denied.
    negations = ["no", "not", "without", "never", "none", "denies", "denied", "lack", "lacks"]

    # CRITICAL indicators (explicit catastrophic impact only).
    critical_phrases = [
        "full database dump", "full db dump", "database dump",
        "data exfiltration", "remote code execution", "full system takeover",
        "root shell", "credentials leaked", "credentials leak", "credentials stolen",
        "data leaked"
    ]
    for p in critical_phrases:
        # Skip negated catastrophic claims like "no data leak".
        if _contains_phrase(s, p) and not _has_negated_phrase(s, p, negations):
            return "Critical", "explicit_critical_phrase"

    # Match keyword-only critical indicators with negation guard.
    if "rce" in tokens and not _has_negated_phrase(s, "rce", negations):
        return "Critical", "explicit_critical_keyword"
    # Prefix match for "exfiltrat..." to capture exfiltration variants without substrings.
    if any(t.startswith("exfiltrat") for t in tokens) and not _has_negated_phrase(s, "exfiltration", negations):
        return "Critical", "explicit_critical_keyword"

    # HIGH indicators
    high_phrases = [
        "privilege escalation", "auth bypass", "authentication bypass",
        "gain admin", "become admin", "write access to sensitive",
        "access sensitive data", "modify users", "create admin",
        "unauthenticated access to", "access to sensitive"
    ]
    for p in high_phrases:
        if _contains_phrase(s, p):
            return "High", "explicit_high_phrase"
    # Prefix keyword match for escalation while avoiding substring matches.
    if any(t.startswith("elevat") for t in tokens):
        return "High", "explicit_high_keyword"

    # MEDIUM indicators (info disclosure, schema leaks, etc.)
    medium_phrases = [
        "table", "column", "schema", "schema info", "verbose error",
        "error message", "stack trace", "information disclosure",
        "reveals", "revealed", "expose", "exposes", "sql error",
        "sql exception", "helps attackers", "reconnaissance",
        "no direct data", "no data compromised", "no data leak"
    ]
    medium_count = sum(1 for p in medium_phrases if _contains_phrase(s, p))
    if medium_count >= 1:
        # Explicit non-compromise statements stay Medium and should not escalate.
        if any(_contains_phrase(s, k) for k in ["no direct data", "no data compromised", "no data leak"]):
            return "Medium", "info_disclosure_no_data"
        return "Medium", "info_disclosure"

    # LOW indicators
    low_phrases = [
        "x-frame-options", "missing header", "content-security-policy",
        "csp", "http-only", "strict-transport-security", "hsts",
        "best practise", "best practice", "minor", "typo", "ui issue",
        "cosmetic", "ui-only"
    ]
    for p in low_phrases:
        if _contains_phrase(s, p):
            return "Low", "low_best_practice"

    return None, "inconclusive"

# -------------------------
# Strict LLM system prompt
# -------------------------
SYSTEM_PROMPT = (
    "You are a security vulnerability severity classification assistant. "
    "INPUT: title and short description of a bug report. "
    "TASK: Return EXACTLY ONE label: Critical, High, Medium, or Low. "
    "DEFINITIONS (IMMEDIATE IMPACT ONLY): "
    "- Critical: immediate unauthenticated RCE, immediate full database dump, full admin takeover, or equivalent catastrophic impact. "
    "- High: immediate significant data loss, privilege escalation, or auth bypass exposing sensitive data or admin controls. "
    "- Medium: information disclosure, useful reconnaissance, or non-catastrophic vulnerabilities. "
    "- Low: minor misconfigurations or best-practice issues without direct impact. "
    "RULES: 1) Classify based ONLY on the information given and ONLY on immediate impact. "
    "2) Do NOT escalate severity solely because the issue 'could' enable further attacks. "
    "3) If the description says 'no direct data compromise' or similar, treat info leak as Medium. "
    "REPLY with ONLY one label and NOTHING ELSE."
)

# -------------------------
# Main async analyzer
# -------------------------
async def analyze_severity_async(bug: BugReport):
    title = bug.title
    desc = bug.description
    s = (title + " " + desc).lower()

    # Rule-based classification
    rule_label, rule_reason = classify_with_rules(title, desc)
    if rule_label is not None:
        logging.debug(f"Rule classifier chose {rule_label} ({rule_reason}) for: {title}")
        label = rule_label
    else:
        # Fall back to LLM if rules inconclusive
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Title: {title}\nDescription: {desc}"}
        ]
        try:
            completion = await client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                temperature=0.0,
                max_completion_tokens=12,
                top_p=1,
                stream=False
            )
            severity_raw = completion.choices[0].message.content.strip()
            severity = re.sub(r'[^A-Za-z]', '', severity_raw).capitalize()
            valid_labels = {"Critical", "High", "Medium", "Low"}
            label = severity if severity in valid_labels else "Medium"
        except Exception:
            logging.exception("Error calling model, falling back to Medium.")
            label = "Medium"

    # Override: schema info + facilitation markers → High
    schema_terms = ["schema", "table", "column", "sql exception", "verbose error"]
    facilitation_terms = [
        "lowers barrier", "helps attacker", "helps attackers",
        "facilitat", "targeted sql", "precise sql",
        "materially lowers", "significantly lowers"
    ]
    if any(t in s for t in schema_terms) and any(f in s for f in facilitation_terms):
        logging.debug("Override: schema + facilitation detected → High")
        label = "High"

    # Safeguard: only Critical if explicit catastrophic indicators present
    critical_indicators = [
        "full database dump", "database dump", "data exfiltrat",
        "data leaked", "remote code execution", "rce", "root shell"
    ]
    if label == "Critical" and not any(k in s for k in critical_indicators):
        logging.info("Downgrading Critical to High (no explicit catastrophic evidence).")
        label = "High"

    return label

# -------------------------
# Flask endpoint wrapper
# -------------------------
@app.route("/api/analyzeSeverity", methods=["POST"])
def analyze_severity():
    try:
        data = request.json
        bug = BugReport(**data)

        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            severity = loop.run_until_complete(analyze_severity_async(bug))
            loop.close()
        except RuntimeError:
            severity = asyncio.get_event_loop().run_until_complete(analyze_severity_async(bug))

        return jsonify({"severity": severity})

    except ValidationError as ve:
        logging.error(f"Validation error: {ve}", exc_info=True)
        return jsonify({"error": "Invalid input data"}), 400

    except Exception as e:
        logging.error(f"Error in analyze_severity: {e}", exc_info=True)
        return jsonify({"error": "Error processing request."}), 500

# -------------------------
# Chat endpoint for BugHuntr Assistant
# -------------------------
@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()
        if not data or 'message' not in data:
            return jsonify({"error": "Message is required"}), 400
        
        user_message = data['message']
        session_id = data.get('session_id', 'default')
        context = data.get('context', '')
        platform_features = data.get('platform_features', [])
        
        # Check if message is BugHuntr-related
        bughuntr_keywords = [
            'bug', 'vulnerability', 'security', 'bounty', 'submission', 'hunt', 'platform',
            'navigate', 'feed', 'dashboard', 'profile', 'firebase', 'code', 'admin',
            'certificate', 'community', 'leaderboard', 'report', 'submission', 'review',
            'company', 'severity', 'critical', 'high', 'medium', 'low', 'poc', 'proof',
            'authentication', 'authorization', 'xss', 'sql', 'injection', 'csrf',
            'cybersecurity', 'penetration', 'testing', 'endpoint', 'api', 'database'
        ]
        
        message_lower = user_message.lower()
        is_bughuntr_related = any(keyword in message_lower for keyword in bughuntr_keywords)
        
        # If not BugHuntr-related, provide redirect response
        if not is_bughuntr_related:
            redirect_response = """🛡️ I'm specifically designed to help with the BugHuntr platform. I can assist you with:

📍 **Navigation**: "Navigate to feed", "Go to dashboard", "Take me to submissions"
🐛 **Bug Hunting**: Submission process, severity levels, proof of concepts
🔒 **Security**: Vulnerability types, analysis techniques, best practices  
⚙️ **Platform Features**: Communities, leaderboards, certificates, admin tools
💻 **Code Help**: Firebase integration, form submissions, API usage

What would you like to know about BugHuntr?"""
            
            return jsonify({
                "response": redirect_response,
                "session_id": session_id
            })
        
        # Enhanced system prompt for BugHuntr-specific responses
        system_prompt = f"""You are the BugHuntr Assistant, an expert AI specialized EXCLUSIVELY in the BugHuntr cybersecurity platform. 

STRICT GUIDELINES:
- ONLY discuss BugHuntr platform features, cybersecurity, bug bounty hunting, and related technical topics
- NEVER engage with topics outside cybersecurity/BugHuntr scope (weather, general conversation, etc.)
- Always redirect off-topic queries back to BugHuntr capabilities

YOUR EXPERTISE AREAS:
🎯 **Platform Navigation**: Feed, Dashboard, Profile, Submissions, Communities, Leaderboards, Certificates
🐛 **Bug Hunting Process**: Submission workflow, severity classification (Critical/High/Medium/Low), POC requirements
🔒 **Security Concepts**: Vulnerability types (XSS, SQL Injection, CSRF, etc.), penetration testing, security analysis
👥 **User Management**: Admin vs regular users, company-specific access, role-based permissions
💻 **Technical Integration**: Firebase setup, form submissions, API endpoints, database operations
🏆 **Gamification**: Points system, certificates, ranking algorithms, community features

RESPONSE FORMAT:
- Use emojis and clear formatting
- Provide specific, actionable information
- Include code examples when relevant
- Mention relevant platform features
- Keep responses concise but comprehensive

Current platform features available: {', '.join(platform_features)}

Context: {context}"""
        
        # Use the existing Groq client to generate response
        async def get_chat_response():
            try:
                completion = await client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message}
                    ],
                    model="llama-3.1-8b-instant",
                    temperature=0.7,
                    max_tokens=1000,
                )
                return completion.choices[0].message.content
            except Exception as e:
                logging.error(f"Error getting chat response: {e}")
                return """🛡️ **BugHuntr Assistant Ready!**

I'm here to help with:
• **Navigate**: Type "navigate to [page]" for quick access
• **Bug Submission**: Guide through the reporting process  
• **Security Analysis**: Explain vulnerability types and severity
• **Platform Features**: Communities, leaderboards, certificates
• **Code Examples**: Firebase integration, form handling

What aspect of BugHuntr would you like to explore?"""
        
        # Run the async function
        response = asyncio.run(get_chat_response())
        
        return jsonify({
            "response": response,
            "session_id": session_id
        })
        
    except Exception as e:
        logging.error(f"Error in chat endpoint: {e}", exc_info=True)
        return jsonify({
            "response": """🛡️ **BugHuntr Assistant**

I'm your dedicated cybersecurity platform assistant. I can help with:

🎯 **Quick Navigation**: "Navigate to feed", "Go to dashboard"
🐛 **Bug Hunting**: Submission process, severity analysis
🔒 **Security Help**: Vulnerability explanations, best practices
⚙️ **Platform Features**: All BugHuntr capabilities

What would you like to know about BugHuntr?""",
            "session_id": "bughuntr-session"
        }), 200

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    app.run(host="0.0.0.0", port=8000)
