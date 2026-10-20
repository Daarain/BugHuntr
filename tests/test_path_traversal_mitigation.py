"""
Tests for SEC-09: Path traversal mitigation in file uploads
"""
import os
import tempfile
import uuid
from werkzeug.utils import secure_filename

def sanitize_upload_filename(raw_filename: str, allowed_extensions: set) -> tuple:
    """Replicates the sanitized path resolution logic in Doc-Verification.py and report-detection.py"""
    if not raw_filename or "." not in raw_filename:
        return False, None
    
    ext = raw_filename.rsplit(".", 1)[1].lower()
    if ext not in allowed_extensions:
        return False, None
        
    safe_name = secure_filename(os.path.basename(raw_filename))
    if not safe_name:
        safe_name = f"upload_{uuid.uuid4().hex[:8]}.{ext}"
        
    return True, safe_name


def test_path_traversal_blocked():
    allowed = {"png", "jpg", "pdf", "docx"}
    
    # Classic dot-dot-slash attacks
    attacks = [
        "../../../../etc/passwd.png",
        "..\\..\\..\\windows\\system32\\cmd.exe.png",
        "....//....//shell.php.jpg",
        "/etc/shadow.pdf",
        "C:\\Windows\\System32\\drivers\\etc\\hosts.docx",
    ]
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_abs = os.path.abspath(temp_dir)
        
        for attack in attacks:
            is_valid, safe_name = sanitize_upload_filename(attack, allowed)
            assert is_valid is True
            assert "/" not in safe_name
            assert "\\" not in safe_name
            assert ".." not in safe_name
            
            resolved_path = os.path.abspath(os.path.join(temp_dir, safe_name))
            assert resolved_path.startswith(temp_dir_abs + os.sep)


def test_disallowed_extensions_rejected():
    allowed = {"png", "jpg", "pdf", "docx"}
    dangerous_files = [
        "exploit.exe",
        "backdoor.php",
        "malware.sh",
        "config.env",
        "shell.jsp",
    ]
    
    for file in dangerous_files:
        is_valid, _ = sanitize_upload_filename(file, allowed)
        assert is_valid is False


if __name__ == "__main__":
    test_path_traversal_blocked()
    test_disallowed_extensions_rejected()
    print("OK: Path traversal mitigation tests passed.")
