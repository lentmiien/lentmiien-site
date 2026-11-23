# Insurance

Open **Insurance** at `/insurance/`. Unreviewed shows stored Document Vault invoices once duplicate review clears. Move eligible invoices to Processing. In Unreviewed or Processing, choose **No further action** if an invoice does not need a claim, or **Expired** if it is too old to claim.

## Plan library

Admin and family accounts can browse family policies under **Plan library**. An administrator adds or edits a plan for an admin or family policyholder. Record the plan name, insurer, effective date, monthly premium and currency, policy number, coverage, claim website, and instructions for submission and follow-up. The policy number is available through a separate private reveal page. Leaving the replacement field blank keeps the saved number. The claim website opens separately, and the user submits the claim with the insurer.

## Preparing and submitting a batch

In **Processing**, select invoices for one policyholder and choose **Create draft from selected invoices**. Reopen drafts under **Finalize batch**. Use the document picker to add processing invoices or search filed vault documents accessible to both you and the policyholder by title and attach supporting scans. Return an invoice to Processing, remove a supporting document, or discard the whole draft as needed. Save the plan and preparation notes using **Save draft details**.

Download the scans or open individual documents for the claim. Once submitted to the insurer, select the plan, enter the actual submission date, and choose **Record submission**. Each submission has a separate history entry, including claims submitted on the same date. The batch captures the plan details, document titles, dates, amounts, scan references and notes. Subsequent edits to the library do not alter a submitted plan. Only follow-up notes and claim outcomes can be updated. Original scans are referenced in the vault and downloads require current source access.

Existing unreviewed and processing items continue in their queues. Previously completed claims retain their owner/date history and scan links. Family members with access to the whole historical batch can add follow-up notes. Summaries cover all accessible results, use the document month for active queues and submission month for submitted batches, and keep currencies separate.

## Security and storage

Insurance is a logged-in feature for sensitive family records. Existing invoice triage requires vault read capability and current vault owner/viewer access. The plan library is household-wide, with `insurance.plans.read` for admin and family accounts and `insurance.plans.manage` for administrators. Batch preparation, submission and follow-up require admin or family account type, `insurance.batches.manage`, and owner or viewer access. There is no administrative override for source documents or batches. A delegate must have access to **every** attached source group to access a batch or its notes. Drafts with no invoices retain an invoice group for authorization. Invoices must have the batch owner. Supporting documents may also come from other owners if shared with both the policyholder and the preparer. External supporting documents retain their vault access requirements. Invoice eligibility is checked again at submission.

Private MongoDB collections `insuranceclaims`, `insuranceplans` and `insurancebatches` are excluded from the generic database viewer. The importer only creates missing invoice references. Explicit batches store membership in one document with a unique invoice membership index. Membership determines whether a processing invoice belongs to a draft, was submitted, or was subsequently dismissed or marked expired. Removing draft membership returns the invoice to Processing. Revision-checked atomic writes support standalone MongoDB. Back up all three collections with the vault.

Browser mutations use bounded, rate-limited CSRF-protected POSTs. Views use escaped content, private no-store responses and no analytics. Claim instructions accept HTTPS links and the server does not contact insurers. Each draft holds up to 128 scans, with paginated document pickers. Content-free operational errors go through the application logger.
