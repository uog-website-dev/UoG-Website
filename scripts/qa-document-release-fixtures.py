"""Generate deterministic, non-sensitive P4-DOC-009 document fixtures."""
from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "docs" / "qa" / "P4-DOC-009" / "fixtures"


def pdf_bytes(lines: list[str]) -> bytes:
    def escape(value: str) -> str:
        return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    content = ["BT", "/F1 18 Tf", "72 750 Td"]
    for index, line in enumerate(lines):
        if index:
            content.append("0 -30 Td")
        content.append(f"({escape(line)}) Tj")
    content.append("ET")
    stream = "\n".join(content).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n%P4-DOC-009 fixture\n")
    offsets = [0]
    for number, payload in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii"))
        output.extend(payload)
        output.extend(b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    return bytes(output)


def office_bytes(kind: str, title: str) -> bytes:
    if kind == "docx":
        entries = {
            "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>",
            "_rels/.rels": "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>",
            "word/document.xml": f"<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>{title}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>",
        }
    elif kind == "xlsx":
        entries = {
            "[Content_Types].xml": "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>",
            "_rels/.rels": "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>",
            "xl/workbook.xml": "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Release QA\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
            "xl/_rels/workbook.xml.rels": "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
            "xl/worksheets/sheet1.xml": f"<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>{title}</t></is></c></row></sheetData></worksheet>",
        }
    else:
        raise ValueError(kind)
    from io import BytesIO
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in entries.items():
            archive.writestr(name, value)
    return buffer.getvalue()


def write_bundle(path: Path, title: str) -> bytes:
    from io import BytesIO
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.txt", f"{title}\nP4-DOC-009 synthetic release fixture.\nNo personal data.\n")
        archive.writestr("forms/index.txt", "Use only for QA validation.\n")
    return buffer.getvalue()


def main() -> None:
    documents = {
        "main-university": [
            ("policy.pdf", "Main University Public Policy", "Policies", False, ["University of Gondar", "Public policy", "Synthetic release acceptance fixture"]),
            ("admissions-login.pdf", "Main University Admissions Guide", "Student resources", True, ["University of Gondar", "Admissions guide", "Login-required test file"]),
            ("student-handbook.docx", "Main University Student Handbook", "Student resources", False, None),
            ("budget-template.xlsx", "Main University Budget Template", "Forms", False, None),
            ("records-package.zip", "Main University Records Package", "Forms", False, None),
        ],
        "informatics-college": [
            ("college-regulations.pdf", "College of Informatics Regulations", "Policies", False, ["College of Informatics", "Academic regulations", "Synthetic release acceptance fixture"]),
            ("registrar-login.pdf", "College Registrar Procedure", "Staff resources", True, ["College of Informatics", "Registrar procedure", "Login-required test file"]),
            ("faculty-handbook.docx", "College Faculty Handbook", "Staff resources", False, None),
            ("course-schedule.xlsx", "College Course Schedule", "Forms", False, None),
            ("registrar-forms.zip", "College Registrar Forms", "Forms", False, None),
        ],
    }
    manifest = {"run": "P4-DOC-009", "synthetic": True, "sites": {}}
    for site_slug, rows in documents.items():
        site_dir = ROOT / site_slug
        site_dir.mkdir(parents=True, exist_ok=True)
        manifest["sites"][site_slug] = {"documents": []}
        for filename, title, category, login, lines in rows:
            suffix = Path(filename).suffix.lower()
            if suffix == ".pdf":
                payload = pdf_bytes(lines or [title, "Synthetic release acceptance fixture", "No personal data"])
            elif suffix == ".docx":
                payload = office_bytes("docx", title)
            elif suffix == ".xlsx":
                payload = office_bytes("xlsx", title)
            elif suffix == ".zip":
                payload = write_bundle(site_dir / filename, title)
            else:
                raise ValueError(filename)
            path = site_dir / filename
            path.write_bytes(payload)
            manifest["sites"][site_slug]["documents"].append({
                "filename": filename, "title": title, "category": category,
                "require_login_to_download": login, "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            })
    invalid_dir = ROOT / "invalid"
    invalid_dir.mkdir(parents=True, exist_ok=True)
    (invalid_dir / "mismatched-pdf.pdf").write_bytes(b"This is not a PDF.\n")
    (invalid_dir / "active-content.zip").write_bytes(b"PK\x03\x04malformed active archive\n")
    manifest["invalid_fixtures"] = ["invalid/mismatched-pdf.pdf", "invalid/active-content.zip"]
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"fixture_root": str(ROOT), "sites": {key: len(value["documents"]) for key, value in manifest["sites"].items()}, "invalid_fixtures": len(manifest["invalid_fixtures"])}, indent=2))


if __name__ == "__main__":
    main()
