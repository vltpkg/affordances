# streamed-next16.3.html: how it was captured

The app in `streamed-react19.capture.md`, built and started with Next 16.3.0 instead of 16.4.3 (React 19.3.1,
react-dom 19.3.1, `next build --webpack`), saved with `curl -s localhost:3403/products`. 16.3.0 is the oldest Next a
known user of the handler runs.

It reveals its boundaries the same way as 16.4.3 (`$RC` for each, `$RX` for the one left to the client, `B:`/`S:` ids
running into hex), so its golden file is the same as `streamed-react19.md`.
