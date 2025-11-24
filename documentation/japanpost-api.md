Overview
- Base URL: https://www.api-mypage.post.japanpost.jp/webapi/servlet/WEBAPI
- Method: POST (application/x-www-form-urlencoded). GET works but POST is recommended.
- Auth on every call: ctId (user ID), ctPw (password)
- Response format: XML (UTF-8), envelope tag EmsApiResultInfo
- Files (PDF/CSV) are created server‑side; you receive a download URL. Retention: 1 week.

Response envelope (all operations)
- ResultCode: 00=OK, 50=parameter error, 51=auth error, 90=server error
- ResultText: human-readable message (Japanese); for 50 includes field error hints
- functionCode: echo of ctCode
- Optional fields depending on operation:
  - TrackingNumber: assigned when creating a label (ctCode=52)
  - DownLoadUrl: URL to download created PDF/CSV
  - PostalRate: postage calculated for the request (when available)
  - InsuranceCost: ancillary fee result (when available)
  - StatusJa/StatusEn: tracking status (ctCode=77)

Primary operation: Create EMS label PDF (ctCode=52)
Purpose
- Creates the shipping label and related forms (CN22/CN23 as applicable). Can also print invoice pages.

Basic request fields
- Required always
  - ctCode=52
  - ctId, ctPw
  - sendDate: YYYY/MM/DD (today through 7 days ahead; past/far-future rejected)
  - sendType: 0 (EMS Documents) or 1 (EMS Goods)
- Sender (from_*)
  - from_nam or from_companyName: at least one required
  - from_postal, from_add1 (building/floor), from_add2 (street), from_add3 (city), from_pref (prefecture/state in the official English spelling), from_tel
  - Optional: from_postName (dept), from_fax, from_exportCode (exporter code)
- Recipient (to_*)
  - to_nam or to_companyName: at least one required
  - to_postal, to_add1 (building/floor), to_add2 (street), to_add3 (city), to_pref (state in English where applicable), to_couCd (country code), to_tel
- Package and contents
  - EMS Documents (sendType=0): do not include item lines (error if present)
  - EMS Goods (sendType=1): include item lines
    - totalWeight: grams (service/country max enforced)
    - pkgType: content type (gift, documents, sample, sale, returned goods, others)
    - pkgTotalcnt: total number of pieces in contents
    - pkgTotalPrice: total declared value in JPY (8 digits)
    - item lines (repeat up to 60):
      - item_pkg (description), item_hsCode (up to 7), item_country (origin; must exist in Country Master; “JP” accepted), item_num, item_weight (g), item_cost (unit price), item_curUnit (3-letter currency; any letters accepted; decimals up to 2)

Invoice printing
- invPrintType:
  - 0 = print default copies (per Country Master; default if omitted)
  - 1 = print specified copies (set invPrintNum)
  - 2 = do not print invoices
- invPrintNum: required if invPrintType=1
- Optional invoice/tax fields: taxCode (VAT/IOSS/EORI, etc.), invoiceNum, payCond, invBiko (notes), licenceNum, certNum
- noCm: 1 if free-of-charge cargo, else 0

Optional fields for advanced flows
- laterPayNumber1..4: if you use later-pay slips (ctCode=60/61) later; if any are present, totalWeight becomes mandatory
- copyPrint: 1 to suppress the customer/post-office copies on the label PDF (so you can print consolidated copies later via ctCode=61)

Validation highlights (server)
- sendDate: not past; not more than 7 days ahead (E002/E003)
- Destination acceptance: EMS must be supported by destination (E004/E007)
- For EMS Documents (0): no item lines allowed (E006)
- For EMS Goods (1): item lines required; arrays limited to 60 lines; per-line item_num × item_weight ≤ 99,999 g; total item count limited (E025–E028)
- totalWeight: must be ≤ destination’s EMS max weight (E014)
- from_pref and to_pref: must match the published English spelling list (case-insensitive) (E010/E013)
- to_couCd: must exist in Country Master (E013)

Sample: create EMS goods label with invoice
HTTP request
- URL: https://www.api-mypage.post.japanpost.jp/webapi/servlet/WEBAPI
- Headers: Content-Type: application/x-www-form-urlencoded
- Body (single line, URL-encoded; example minimal):
ctCode=52&ctId=YOUR_ID&ctPw=YOUR_PW
&sendDate=2025%2F01%2F10&sendType=1
&from_nam=Taro+Yubin&from_postal=100-8798&from_add1=%23203+Yubin-building&from_add2=3-2+Kasumigaseki+1-Chome&from_add3=Chiyoda-ku&from_pref=Tokyo&from_tel=03-1234-5678
&to_nam=Hanako+Yubin&to_postal=100-0001&to_add1=%23123+Central+Apt&to_add2=1-2-3+Chiyoda&to_add3=Tokyo&to_pref=Tokyo&to_couCd=US&to_tel=1-212-555-0000
&totalWeight=1050&pkgType=3&pkgTotalcnt=3&pkgTotalPrice=17000
&item_pkg=mechanical+pencil&item_hsCode=960840&item_country=JP&item_num=10&item_weight=50&item_cost=1000&item_curUnit=JPY
&item_pkg=eraser&item_hsCode=401692&item_country=JP&item_num=10&item_weight=5&item_cost=200&item_curUnit=JPY
&item_pkg=note&item_hsCode=482010&item_country=JP&item_num=10&item_weight=40&item_cost=500&item_curUnit=JPY
&invPrintType=0

Expected response (XML, key fields)
- ResultCode=00 on success
- TrackingNumber: EMS tracking number assigned (e.g., EL012345678JP)
- DownLoadUrl: HTTPS URL to the label PDF (valid 1 week)
- PostalRate: postage for the shipment
- InsuranceCost: computed ancillary charge if declared/insurance value is provided

Special case: shipments with total value over 200,000 JPY (POA)
- The label (ctCode=52) will not automatically include a Customs Power of Attorney form, even above 200,000 JPY.
- If you need a POA, call ctCode=53 after label creation.
- Required fields for ctCode=53:
  - ctCode=53, ctId, ctPw
  - trackingNumber: the one issued by ctCode=52
  - Sender details: same validations as in 52; from_mail can be printed on the POA
- Response for ctCode=53:
  - ResultCode=00 on success
  - DownLoadUrl: URL to the POA PDF (valid 1 week)

Sample: create POA after label
Body (URL-encoded; replace trackingNumber with the one from 52):
ctCode=53&ctId=YOUR_ID&ctPw=YOUR_PW
&trackingNumber=EL012345678JP
&from_nam=Taro+Yubin&from_postal=100-8798&from_add1=%23203+Yubin-building&from_add2=3-2+Kasumigaseki+1-Chome&from_add3=Chiyoda-ku&from_pref=Tokyo&from_tel=03-1234-5678&from_mail=sender%40example.com

Download created files
- After 52 or 53, fetch the PDF from DownLoadUrl via HTTPS within 7 days.
- Files have non-guessable names; store the returned URL and your tracking number.

Common errors to expect (ResultCode=50 with messages)
- Past or too-far future sendDate (E002/E003)
- EMS not accepted for destination (E004/E007)
- Items present for EMS Documents (E006) or missing/invalid for EMS Goods (E025–E028)
- Weight exceeds destination/service limit (E014)
- Invalid prefecture/state spelling or country code (E010/E013)

Implementation checklist
- Validate sendDate window and addresses before calling the API.
- For EMS Goods, include item lines and ensure totals and per-line limits pass.
- Set invoice printing via invPrintType (and invPrintNum if needed).
- Parse XML to capture TrackingNumber and DownLoadUrl; download label PDF.
- If declared value > 200,000 JPY and you need a POA, call ctCode=53 with trackingNumber; download POA PDF.
- Store TrackingNumber, file URLs, ResultCode/ResultText for diagnostics.

Notes
- Character encoding: requests are URL-encoded; responses are UTF‑8 XML.
- For recipient address/name, full-width characters are allowed and printed using a CJK font; other fields should use half-width ASCII.
- If you plan to print later-pay slips or consolidated copies, include laterPayNumber1..4 and/or copyPrint in ctCode=52; otherwise you can ignore those fields.