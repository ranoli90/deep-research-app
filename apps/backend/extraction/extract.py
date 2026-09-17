"""Offline extraction subprocess. The launcher supplies bytes and enforces OS isolation."""
import base64
import hashlib
import io
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

from lxml import etree, html
import trafilatura

VERSION = "trafilatura-2.2.0/structure-v1"
MAX_BYTES = 8 * 1024 * 1024


def normalized(element):
    return " ".join(" ".join(element.itertext()).split())


def extract(request):
    raw = base64.b64decode(request["bytes"], validate=True)
    if len(raw) > MAX_BYTES:
        raise ValueError("too_large")
    result = {"version": VERSION, "digest": hashlib.sha256(raw).hexdigest(),
              "blocks": [], "warnings": [], "status": "partial"}
    mime = request["mime"].split(";")[0].strip().lower()
    if mime in ("text/plain", "text/markdown"):
        text = raw.decode("utf-8", errors="strict")
        for index, paragraph in enumerate(text.split("\n\n")):
            if paragraph.strip():
                result["blocks"].append({"kind": "text", "text": paragraph.strip(),
                                         "locator": f"paragraph:{index}", "rows": []})
        result["status"] = "extracted" if result["blocks"] else "unavailable"
        return result
    if mime == "application/pdf":
        result["version"] = "docling-parse-7.20.0/geometry-v1"
        result["warnings"] = ["pdf_layout_tables_and_ocr_unverified"]
        try:
            from pypdf import PdfReader
            if not raw.startswith(b"%PDF-"):
                raise ValueError("invalid_header")
            reader = PdfReader(io.BytesIO(raw), strict=True)
            if reader.is_encrypted:
                result.update(status="unavailable", warnings=["encrypted_pdf_unsupported"])
                return result
            page_count = len(reader.pages)
            if page_count > 200:
                result["warnings"].append("page_limit_200")
            from docling_parse.pdf_parser import DoclingPdfParser, ContentConfig, ContentLevel, DecodeConfig
            parser = DoclingPdfParser(loglevel="fatal")
            document = parser.load(io.BytesIO(raw), decode_config=DecodeConfig(do_sanitization=True, keep_glyphs=False),
                content_config=ContentConfig(char_cells_content_level=ContentLevel.SKIP,
                    word_cells_content_level=ContentLevel.SKIP, line_cells_content_level=ContentLevel.COMPUTE_AND_MATERIALIZE,
                    shapes_content_level=ContentLevel.SKIP, bitmaps_content_level=ContentLevel.SKIP))
            unread = []
            for index in range(min(page_count, 200)):
                page = document.get_page(index + 1)
                cells = sorted(page.textline_cells, key=lambda cell: (-cell.rect.to_bounding_box().t, cell.rect.to_bounding_box().l))
                lines = []
                geometry = []
                for cell in cells:
                    box = cell.rect.to_bounding_box()
                    geometry.append({"text": cell.text, "box": [box.l, box.b, box.r, box.t]})
                    # Font runs may be drawn separately from the surrounding sentence. Restore their physical line.
                    # This is not column/layout inference; keep that limitation on every PDF result.
                    if lines and abs(lines[-1][0] - box.t) <= 2:
                        lines[-1][1].append(cell)
                    else:
                        lines.append((box.t, [cell]))
                text = "\n".join("".join(cell.text for cell in sorted(line, key=lambda cell: cell.rect.to_bounding_box().l))
                                 for _, line in lines).strip()
                if text:
                    result["blocks"].append({"kind": "text", "locator": f"page:{index + 1}/block:0",
                                             "text": text, "rows": [], "geometry": geometry})
                else:
                    unread.append(index + 1)
                document.unload_pages((index + 1, index + 1))
            document.unload()
            if unread:
                result["warnings"].append("pages_without_digital_text:" + ",".join(map(str, unread[:30])))
            result["status"] = "partial" if result["blocks"] else "unavailable"
        except Exception:
            result.update(status="unavailable", blocks=[], warnings=["invalid_pdf"])
        return result
    if mime not in ("text/html", "application/xhtml+xml"):
        result.update(status="unavailable", warnings=["unsupported_mime"])
        return result
    document = html.fromstring(raw)
    # Scripts, challenge fallbacks and form fields are not documentary content.
    for element in document.xpath("//script|//style|//noscript|//form|//nav|//header|//footer"):
        element.drop_tree()
    if len(normalized(document)) < 40:
        result.update(status="unavailable", warnings=["insufficient_static_content"])
        return result
    # Preserve original table structure separately. Trafilatura discards colspan/rowspan.
    tables = document.xpath("//table[not(ancestor::table)]")
    table_blocks = []
    for index, table in enumerate(tables):
        rows = []
        for row in table.xpath(".//tr[not(ancestor::td or ancestor::th)]"):
            cells = []
            for cell in row.xpath("./th|./td"):
                def span(key):
                    value = cell.get(key, "1")
                    return min(1000, max(1, int(value))) if value.isdigit() else 1
                cells.append({"text": normalized(cell), "header": cell.tag == "th",
                              "colspan": span("colspan"), "rowspan": span("rowspan"),
                              "scope": cell.get("scope", "")})
            if cells:
                rows.append(cells)
        if rows:
            # Keep footnote targets alongside the table rather than detach their qualification.
            notes = []
            for link in table.xpath('.//a[starts-with(@href,"#")]'):
                targets = document.xpath('//*[@id=$identity]', identity=link.get("href")[1:])
                notes.extend(normalized(target) for target in targets)
            sibling = table.getnext()
            if sibling is not None:
                adjacent = normalized(sibling)
                if adjacent.startswith(("*", "†", "‡", "Note:", "Notes:")) or "footnote" in sibling.get("class", ""):
                    notes.append(adjacent)
            caption = " ".join(normalized(e) for e in table.xpath("./caption"))
            text = "\n".join(filter(None, [caption, *[" | ".join(c["text"] for c in row) for row in rows], *dict.fromkeys(notes)]))
            table_blocks.append({"kind": "table", "locator": f"table:{index}", "text": text, "rows": rows})
    output = trafilatura.extract(etree.tostring(document, encoding="unicode"),
                                output_format="xml", include_tables=False,
                                include_links=True, include_formatting=True)
    if output:
        root = etree.fromstring(output.encode(), parser=etree.XMLParser(resolve_entities=False, no_network=True))
        for index, element in enumerate(root.xpath("./main/*")):
            text = normalized(element)
            if text:
                kind = "heading" if element.tag == "head" else "code" if element.tag == "code" else "text"
                result["blocks"].append({"kind": kind, "locator": f"block:{index}", "text": text, "rows": []})
    result["blocks"].extend(table_blocks)
    result["warnings"] = ["main_content_extraction_may_omit_regions", "table_order_preserved_separately"]
    if not result["blocks"]:
        result.update(status="unavailable", warnings=["insufficient_static_content"])
    if len(result["blocks"]) > 10000:
        raise ValueError("too_many_blocks")
    return result


try:
    line = sys.stdin.buffer.read(2 * MAX_BYTES + 1)
    if len(line) > 2 * MAX_BYTES:
        raise ValueError("too_large")
    print(json.dumps(extract(json.loads(line)), ensure_ascii=False))
except Exception:
    # Never echo source content or parser exceptions into host logs.
    print(json.dumps({"error": "extraction_failed"}))
    sys.exit(1)
