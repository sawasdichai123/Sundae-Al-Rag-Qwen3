import requests
import json
import io

SUPABASE_URL = "https://rcslrctohmbyejwjzoqs.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjc2xyY3RvaG1ieWVqd2p6b3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxOTkzNjMsImV4cCI6MjA4Nzc3NTM2M30.dBFDorftYA20stOmeFgD0JWlJeTyCuY7RhBY4VRl4ds"
API_BASE = "http://localhost:8001"
ORG_ID = "7659c888-53d7-485d-b0e8-8c0586e26a36"
BOT_ID = "f2cef2d9-72e2-4bcb-acd4-8ff34e04e4be"

def login():
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": ANON_KEY,
        "Content-Type": "application/json"
    }
    data = {
        "email": "admin@sundae.local",
        "password": "Sundae@2025"
    }
    resp = requests.post(url, headers=headers, json=data)
    if resp.status_code != 200:
        print("Login failed:", resp.text)
        return None
    return resp.json()["access_token"]

def main():
    token = login()
    if not token:
        return
    
    headers = {"Authorization": f"Bearer {token}"}
    
    print("--- 2. Backend API - Documents ---")
    
    # 2.7 Access without auth
    r = requests.get(f"{API_BASE}/api/documents")
    print("2.7 Access without auth:", "PASSED" if r.status_code in [401, 403] else f"FAILED ({r.status_code})")
    
    # 2.3 List documents
    r = requests.get(f"{API_BASE}/api/documents?organization_id={ORG_ID}", headers=headers)
    print("2.3 List documents:", "PASSED" if r.status_code == 200 else f"FAILED ({r.status_code})")
    
    # 2.1 Upload PDF
    import fitz # PyMuPDF
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Test document content")
    pdf_bytes = doc.tobytes()
    doc.close()
    
    files = {"file": ("test_upload.pdf", pdf_bytes, "application/pdf")}
    data = {"organization_id": ORG_ID, "bot_id": BOT_ID}
    r = requests.post(f"{API_BASE}/api/documents/upload", headers=headers, files=files, data=data)
    doc_id = None
    if r.status_code == 200:
        print("2.1 Upload PDF: PASSED")
        doc_id = r.json().get("document_id")
    else:
        print("2.1 Upload PDF: FAILED", r.text)
        
    # 2.2 Upload non-PDF
    files = {"file": ("test_img.jpg", b"fake_jpg_content", "image/jpeg")}
    r = requests.post(f"{API_BASE}/api/documents/upload", headers=headers, files=files, data=data)
    print("2.2 Upload non-PDF:", "PASSED" if r.status_code == 400 else f"FAILED ({r.status_code})")
    
    if doc_id:
        # 2.4 Get single document
        r = requests.get(f"{API_BASE}/api/documents/{doc_id}?organization_id={ORG_ID}", headers=headers)
        print("2.4 Get single document:", "PASSED" if r.status_code == 200 else f"FAILED ({r.status_code})")
        
        # 2.5 Get single doc wrong org
        r = requests.get(f"{API_BASE}/api/documents/{doc_id}?organization_id=00000000-0000-0000-0000-000000000000", headers=headers)
        print("2.5 Get wrong org:", "PASSED" if r.status_code in [403, 404] else f"FAILED ({r.status_code})")
        
        # 2.6 Delete document
        r = requests.delete(f"{API_BASE}/api/documents/{doc_id}?organization_id={ORG_ID}", headers=headers)
        print("2.6 Delete document:", "PASSED" if r.status_code == 200 else f"FAILED ({r.status_code})")

if __name__ == "__main__":
    main()
