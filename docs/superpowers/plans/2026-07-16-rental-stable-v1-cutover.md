# rental-price-agent stable v1 cutover runbook

## Scope

- MT-agent adapter targets rental-price-agent stable `1.0.0` daemon negotiation.
- This slice exposes image and VAS adapter methods plus hidden MT tool surfaces only.
- Image/VAS mutation tools are not planner-visible and must only run from explicit operator-confirmed requests.

## Read-only smoke with a real daemon

Run only after confirming the production daemon, token, and browser session are intentionally available. Do not run SaaS writes during smoke.

1. Set `RENTAL_PRICE_AGENT_DIR`, `RENTAL_PRICE_AGENT_DAEMON_URL`, and `RENTAL_PRICE_AGENT_DAEMON_TOKEN` for the stable release target.
2. Confirm `rental.daemonStatus` returns `ok` and hello negotiation reports stable version `1.0.0`.
3. Run a single known safe product through `rental.readRaw`, `rental.imageRead`, `rental.vasRead`, and optionally `rental.vasCatalogRead`.
4. Check that each read returns non-error status and no mutation/action audit is created.
5. Do not run `rental.imageUpload`, `rental.imagePick`, `rental.imageOrder`, `rental.whiteImageSet`, or `rental.vasApply` during smoke.

## Production Risks

- Image mutations can change storefront assets and ordering; rollback for images is not claimed here.
- VAS apply changes product service bindings; only existing catalog binding is in scope, not service CRUD.
- Batch image execution requires explicit `confirmImageWithoutPreview=true`; VAS execution has no equivalent no-preview bypass.
- Real success still depends on login state, page structure, account permissions, daemon state digest readiness, and readback verification quality.
- Delayed verify must be treated as fail-closed for missing/zero image or VAS evidence.
