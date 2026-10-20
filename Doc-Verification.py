from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import uuid
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
load_dotenv()
from paddleocr import PaddleOCR
from pdf2image import convert_from_path
import tempfile
import docx
import re
import requests
import bcrypt
from firebase_admin import credentials, firestore, initialize_app

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])

# -------------------------
# Firebase Setup
# -------------------------
# Use environment variable for Firebase credentials path
cred_path = os.getenv('FIREBASE_CREDENTIALS_PATH', './bughuntr-3f895-firebase-adminsdk-fbsvc-488e0dd16e.json')
db = None
if os.path.exists(cred_path):
    try:
        cred = credentials.Certificate(cred_path)
        initialize_app(cred)
        db = firestore.client()
    except Exception as e:
        print(f"Warning: Failed to initialize Firebase: {e}")
else:
    print(f"Warning: Firebase credentials file not found at {cred_path}. Firebase persistence disabled.")

# -------------------------
# OCR Setup
# -------------------------
ocr = PaddleOCR(
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False
)

# -------------------------
# API Key (TheCompaniesAPI)
# -------------------------
THECOMPANIESAPI_KEY = os.getenv("THECOMPANIESAPI_KEY")

# -------------------------
# Allowed file extensions
# -------------------------
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "pdf", "docx"}


# -------------------------
# OCR Helper Functions
# -------------------------
def extract_text_from_image(image_path):
    """Extract text using PaddleOCR predict method"""
    try:
        print(f"Processing image: {image_path}")
        
        result = ocr.predict(image_path)
        
        if not result:
            print("No OCR results returned")
            return ""
        
        all_text = []
        for page_result in result:
            result_json = page_result.json
            ocr_data = result_json.get('res', {})
            
            rec_texts = ocr_data.get('rec_texts', [])
            rec_scores = ocr_data.get('rec_scores', [])
            
            print(f"Found {len(rec_texts)} text regions")
            
            for text, score in zip(rec_texts, rec_scores):
                if text and text.strip() and score > 0.3:
                    clean_text = text.strip()
                    all_text.append(clean_text)
                    print(f"  - '{clean_text}' (confidence: {score:.2f})")
        
        extracted_text = "\n".join(all_text)
        print(f"Total extracted: {len(all_text)} lines, {len(extracted_text)} characters")
        
        return extracted_text
        
    except Exception as e:
        print(f"Error in extract_text_from_image: {e}")
        import traceback
        traceback.print_exc()
        return ""


def extract_text_from_pdf(file_path):
    """Extract text from PDF by converting to images"""
    try:
        images = convert_from_path(file_path, dpi=300)
        all_text = []
        for i, img in enumerate(images):
            temp_img_path = os.path.join(tempfile.gettempdir(), f"temp_page_{i}.png")
            try:
                img.save(temp_img_path, 'PNG')
                text = extract_text_from_image(temp_img_path)
                if text:
                    all_text.append(text)
            finally:
                if os.path.exists(temp_img_path):
                    try:
                        os.remove(temp_img_path)
                    except:
                        pass
        return "\n".join(all_text)
    except Exception as e:
        print(f"Error in extract_text_from_pdf: {e}")
        return ""


def extract_text_from_docx(file_path):
    """Extract text from DOCX file"""
    doc = docx.Document(file_path)
    return "\n".join([para.text for para in doc.paragraphs])


def extract_name(text, provided_name):
    """Extract user name from text"""
    if not text or not provided_name:
        return None
    
    provided_name_clean = provided_name.strip()
    if re.search(re.escape(provided_name_clean), text, re.IGNORECASE):
        print(f"Found exact name match: {provided_name_clean}")
        return provided_name_clean
    
    name_pattern = r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b'
    matches = re.findall(name_pattern, text)
    
    if matches:
        found_name = matches[0]
        print(f"Found name pattern: {found_name}")
        return found_name
    
    print("No name found in document")
    return None


def extract_id(text, provided_id=None):
    """Extract user ID from text (employee ID, student ID, etc.)"""
    if not text:
        return None
    
    if provided_id:
        provided_id_clean = str(provided_id).strip()
        if provided_id_clean in text:
            print(f"Found exact ID match: {provided_id_clean}")
            return provided_id_clean
    
    id_patterns = [
        r'(?:ID|Id|id)[\s:]*([A-Z0-9]{4,15})',
        r'(?:Employee|EMP|Emp)[\s]*(?:ID|Id|id)?[\s:]*([A-Z0-9]{4,15})',
        r'(?:Student|STU|Stu)[\s]*(?:ID|Id|id)?[\s:]*([A-Z0-9]{4,15})',
        r'(?:Registration|Reg)[\s]*(?:No|Number|NUM)?[\s:]*([A-Z0-9]{4,15})',
        r'\b([A-Z]{2,4}\d{4,10})\b',
        r'\b(\d{4,10})\b',
    ]
    
    for pattern in id_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            found_id = match.group(1)
            print(f"Found ID: {found_id}")
            return found_id
    
    print("No ID found in document")
    return None


def extract_company(text, provided_company):
    """Extract company name from text"""
    if not text:
        return None
    
    company_pattern = re.escape(provided_company)
    if re.search(company_pattern, text, re.IGNORECASE):
        return provided_company
    org_pattern = r'\b([A-Z][A-Za-z0-9&.,\- ]{2,}(?:Ltd|LLP|Inc|Corporation|Pvt|Limited|Firm|Company|Enterprises|Associates))\b'
    match = re.search(org_pattern, text, re.IGNORECASE)
    if match:
        return match.group(0)
    return None


def check_org_exists(company_name, api_key=THECOMPANIESAPI_KEY):
    """Check if company exists using TheCompaniesAPI (True/False only)"""
    try:
        if not api_key:
            print("⚠️ Warning: THECOMPANIESAPI_KEY not set, skipping validation")
            return True

        # Normalize company name → convert to domain
        query_name = company_name.strip().lower().replace(" ", "")
        if "." not in query_name:   # assume .com if no domain provided
            query_name = query_name + ".com"

        url = f"https://api.thecompaniesapi.com/v2/companies/{query_name}"
        params = {"token": api_key}

        print(f"🔍 Checking existence for: {query_name}")
        response = requests.get(url, params=params, timeout=10)

        # Existence check only
        if response.status_code == 200:
            print(f"✅ Company domain exists: {query_name}")
            return True
        elif response.status_code == 404:
            print(f"❌ Company domain not found: {query_name}")
            return False
        else:
            print(f"⚠️ API returned {response.status_code}: {response.text}")
            return False

    except Exception as e:
        print("🚨 Error checking company in TheCompaniesAPI:", e)
        return False




def is_allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# -------------------------
# Signup Endpoint
# -------------------------
@app.route("/api/signup", methods=["POST"])
def signup():
    try:
        form = request.form
        print("Received form keys:", list(form.keys()))
        print("Received files:", list(request.files.keys()))

        username = form.get("username", "").strip()
        name = form.get("name", "").strip()
        email = form.get("email", "").strip().lower()
        password = form.get("password", "")
        user_type = form.get("userType", "")
        admin_type = form.get("adminType", "")
        company_name = form.get("companyName", "").strip()
        
        # Get ID based on admin type
        user_id = None
        if admin_type in ["company", "firm"]:
            user_id = form.get("employeeId", "").strip()
        elif admin_type == "student":
            user_id = form.get("studentId", "").strip()

        # Required fields validation
        required_fields = {
            "username": username,
            "name": name,
            "email": email,
            "password": password,
            "userType": user_type,
        }
        missing = [field for field, value in required_fields.items() if not value]
        if missing:
            return jsonify({"error": f"Missing required field(s): {', '.join(missing)}"}), 400

        if len(username) < 3 or len(username) > 20:
            return jsonify({"error": "Username must be between 3 and 20 characters"}), 400

        hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

        validation_errors = []
        supporting_doc = request.files.get("supportingDoc")
        
        if supporting_doc and supporting_doc.filename:
            raw_filename = supporting_doc.filename
            if not is_allowed_file(raw_filename):
                return jsonify({"error": f"Unsupported file type: {raw_filename}"}), 400

            safe_name = secure_filename(os.path.basename(raw_filename))
            if not safe_name or not is_allowed_file(safe_name):
                ext = raw_filename.rsplit('.', 1)[1].lower() if '.' in raw_filename else 'bin'
                safe_name = f"upload_{uuid.uuid4().hex[:8]}.{ext}"

            with tempfile.TemporaryDirectory() as temp_dir:
                temp_dir_abs = os.path.abspath(temp_dir)
                file_path = os.path.abspath(os.path.join(temp_dir, safe_name))
                if not file_path.startswith(temp_dir_abs + os.sep):
                    return jsonify({"error": "Path traversal detected in upload filename."}), 400

                filename = safe_name
                supporting_doc.save(file_path)
                
                try:
                    ext = filename.rsplit('.', 1)[1].lower()
                    if ext in ["jpg", "jpeg", "png"]:
                        text = extract_text_from_image(file_path)
                    elif ext == "pdf":
                        text = extract_text_from_pdf(file_path)
                    elif ext == "docx":
                        text = extract_text_from_docx(file_path)
                    else:
                        text = ""
                    
                    print(f"Extracted text length: {len(text)} characters")
                    
                    # Extract information from document
                    extracted_name = extract_name(text, name)
                    extracted_id = extract_id(text, user_id)
                    extracted_company = extract_company(text, company_name)
                    
                    print("\n" + "="*60)
                    print("OCR EXTRACTION & COMPARISON RESULTS")
                    print("="*60)
                    
                    print(f"\n📄 EXTRACTED TEXT FROM DOCUMENT:")
                    print(f"{text[:500]}...")  # Show first 500 chars
                    
                    print(f"\n🔍 EXTRACTION RESULTS:")
                    print(f"  Name:")
                    print(f"    - Provided: '{name}'")
                    print(f"    - Extracted: '{extracted_name}'")
                    print(f"    - Match: {'✓' if extracted_name and (name.lower() in extracted_name.lower() or extracted_name.lower() in name.lower()) else '✗'}")
                    
                    if user_id:
                        print(f"\n  ID ({admin_type.upper()}):")
                        print(f"    - Provided: '{user_id}'")
                        print(f"    - Extracted: '{extracted_id}'")
                        print(f"    - Match: {'✓' if extracted_id and user_id.lower() == extracted_id.lower() else '✗'}")
                    
                    if admin_type in ["company", "firm"] and company_name:
                        print(f"\n  Company:")
                        print(f"    - Provided: '{company_name}'")
                        print(f"    - Extracted: '{extracted_company}'")
                        print(f"    - Match: {'✓' if extracted_company and company_name.lower() == extracted_company.lower() else '✗'}")
                    
                    print("\n" + "="*60 + "\n")

                    # Name validation (flexible - allow partial matches)
                    if extracted_name and name:
                        name_lower = name.lower()
                        extracted_name_lower = extracted_name.lower()
                        if name_lower not in extracted_name_lower and extracted_name_lower not in name_lower:
                            validation_errors.append(f"Name in document '{extracted_name}' does not match provided name '{name}'")
                    elif not extracted_name:
                        validation_errors.append("Could not find name in document. Please ensure your name is clearly visible")

                    # ID validation (strict match required)
                    if user_id:
                        if not extracted_id:
                            id_type = "Employee ID" if admin_type in ["company", "firm"] else "Student ID"
                            validation_errors.append(f"Could not find {id_type} in document. Please ensure it is clearly visible")
                        elif user_id.lower() != extracted_id.lower():
                            id_type = "Employee ID" if admin_type in ["company", "firm"] else "Student ID"
                            validation_errors.append(f"{id_type} in document '{extracted_id}' does not match provided ID '{user_id}'")

                    # Company validation (for company/firm admins only)
                    if admin_type in ["company", "firm"] and company_name:
                        if not extracted_company:
                            validation_errors.append(f"Could not find company name in document")
                        elif company_name.lower() != extracted_company.lower():
                            validation_errors.append(f"Company name in document '{extracted_company}' does not match provided company '{company_name}'")

                except Exception as doc_ex:
                    print(f"Error processing document: {doc_ex}")
                    import traceback
                    traceback.print_exc()
                    validation_errors.append(f"Error processing document: {str(doc_ex)}")

                # Return validation errors if any
                if validation_errors:
                    return jsonify({
                        "error": "Document verification failed",
                        "details": validation_errors
                    }), 400

                # Check company exists in registry (for company/firm admins)
                if admin_type in ["company", "firm"] and company_name:
                    if not check_org_exists(company_name):
                        return jsonify({"error": "Company not found in registry"}), 400

        # Create user in database
        user_data = {
            "username": username,
            "name": name,
            "email": email,
            "password": hashed_password,
            "userType": user_type,
            "adminType": admin_type,
            "companyName": company_name,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "verified": True  # Auto-verify since OCR validation passed
        }
        
        if db is not None:
            db.collection("users").add(user_data)
            print(f"User {username} registered successfully")
        else:
            print(f"User {username} validated (db client not active)")

        return jsonify({
            "success": True, 
            "message": "User registered successfully. You can now log in."
        })

    except Exception as ex:
        print(f"Signup error: {ex}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Signup failed: {str(ex)}"}), 500


# -------------------------
# Run App
# -------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)