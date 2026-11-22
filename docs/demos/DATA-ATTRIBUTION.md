# Data sources, attribution and takedown

This page covers the third-party data used by six demos added in PR 143:
`llm-trace-3d`, `futures-profile-3d`, `capture-3d`, `orderbook-3d`, `drone-flight-3d` and `otel-trace-3d` (each under `docs/demos/<name>/v1/`).

The demo code, scenes and pages are this project's own work. The data they visualise belongs to the parties named below. Naming a source here is credit, not a claim of ownership, and it is not a statement that the source endorses this project. This page is not legal advice, and where a licence could not be confirmed it says so.

## Takedown, and how to ask

If you own or control any data listed here and want it removed, or want the credit changed, open an issue at https://github.com/hagopjay/x3d.demo/issues titled `Takedown: <demo name>` and say what you want removed. Material will be removed promptly after a request, without argument. Removal means deleting the files from the current tree, and the history can be cleaned on request. A demo's derived scene can be rebuilt from a replacement source or withdrawn. Each demo is one folder, so removal is a small change.

## Summary

| demo | source | owner / author | licence or terms | status |
|---|---|---|---|---|
| `llm-trace-3d` | Langfuse OpenAPI spec (field names only) | Langfuse / ClickHouse, Inc. | MIT (Expat) | licensed, notice below |
| `futures-profile-3d` | Yahoo Finance chart endpoint, ES=F and BTC=F, 1-minute bars | Yahoo; underlying prices from exchange feeds (CME Group) | Yahoo terms; no licence found that permits redistribution | **not confirmed redistributable**; included at the project owner's request |
| `capture-3d` | `sip-rtp.pcapng` from the Wireshark repository | Wireshark project and the capture's original contributors | the Wireshark repository is GPL-2.0-or-later; the capture's own terms were not found | credited; capture terms unconfirmed |
| `capture-3d` | `uncompressed.mcap` from foxglove/mcap | Foxglove Technologies Inc | MIT | licensed, notice below |
| `orderbook-3d` | Kraken public REST API, XBT/USD depth and trades | Payward, Inc. / Kraken | Kraken Global Terms; they appear to restrict making Kraken content available to third parties | **not confirmed redistributable**; included at the project owner's request |
| `drone-flight-3d` | PX4 Flight Review public log `4b7bf5df-6bdb-4815-be4c-070a3c520d60` | the person who uploaded it | the upload page offers public sharing under CC BY 4.0 ("CC-BY PX4 license") | licensed CC BY 4.0, credit below; **the raw log contains GPS data** |
| `drone-flight-3d` | `PX4/pyulog` `test/sample.ulg` | PX4 / pyulog contributors | the pyulog repository's licence (not read here) | credited; licence unconfirmed; used only to test the reader |
| `otel-trace-3d` | Jaeger test traces | The Jaeger Project Authors | Apache-2.0 | licensed, notice below |
| `otel-trace-3d` | jaeger-ui test fixture | The Jaeger Project Authors | Apache-2.0 | licensed, notice below |

File names, byte sizes and sha256 values for every file are in each demo's `README.md`. Each demo folder also has a `NOTICE.md` that points here.

**Correction.** The READMEs of `futures-profile-3d` and `orderbook-3d` say the raw market data is "kept local only" or "not redistributed". That is not accurate: the raw files are present in this repository under each demo's `downloads/` folder. This page is the current statement.

## Details and required notices

### Langfuse (`llm-trace-3d`)

The file `downloads/langfuse-openapi/openapi.yml` is Langfuse's public OpenAPI description, used to check that the synthetic trace's field names are real. The trace itself is synthetic and labelled so on screen. Source: https://github.com/langfuse/langfuse. Langfuse's repository states that content outside its `ee/` directories is under the MIT Expat licence. Whether this particular file lies outside those directories is our reading and was not checked file by file. Copyright line in the repository: "Copyright (c) 2023-2026 ClickHouse, Inc." The MIT text is reproduced below.

### Yahoo Finance (`futures-profile-3d`)

One-minute bars for the ES=F and BTC=F continuous front-month futures, fetched on 2026-11-20 from the Yahoo Finance chart endpoint (`query1.finance.yahoo.com/v8/finance/chart/`). Yahoo says "Copyright (c) 2026 Yahoo. All rights reserved." Prices originate with exchanges; ES is a CME Group contract and CME Bitcoin futures likewise. Yahoo's terms are at https://guce.yahoo.com/terms?locale=en-US and its data disclaimer at https://help.yahoo.com/kb/finance-for-web/SLN2310.html. We did not find a licence that permits republishing the bars. They are included only at the project owner's request, for non-commercial study, and are the first thing to remove if anyone objects. The data is delayed and the demo is not financial advice. This project is not affiliated with Yahoo or CME Group.

### Wireshark (`capture-3d`)

`sip-rtp.pcapng` is Wireshark's own sample capture, fetched from the Wireshark repository (`test/captures/sip-rtp.pcapng`, upstream commit `2294e810f57b`) on 2026-11-20. Wireshark is a trademark of its owners, and the repository is licensed GPL-2.0-or-later (https://gitlab.com/wireshark/wireshark/-/raw/master/COPYING). The file was written by TShark 3.6.11 and records SIP test traffic involving the `bestel.com` and `Verso.com` test users. We did not find a statement of the capture's own terms, so it is credited and not claimed. It contains IP addresses and SIP names from the original test, and an owner or a named person who wants it removed can use the takedown route above.

### Foxglove MCAP (`capture-3d`)

`uncompressed.mcap` is a test file from https://github.com/foxglove/mcap (`rust/mcap/tests/data/uncompressed.mcap`), fetched 2026-11-20. Licence: MIT, "Copyright (c) Foxglove Technologies Inc". The MIT text is reproduced below.

### Kraken (`orderbook-3d`)

Order-book snapshots and trades for XBT/USD, polled from Kraken's public REST API (`api.kraken.com/0/public/Depth` and `/Trades`) on 2026-11-20 between 14:41:50 and 14:47:49 UTC. Kraken is a trademark of Payward, Inc. The governing terms are Kraken's Global Terms, https://www.kraken.com/legal/global-terms. Our reading of them is that they prohibit making Kraken content available to third parties, which would cover the raw files here. We did not read the whole document, so treat this as a likely problem. The raw `depth.ndjson` and `trades.ndjson` are included only at the project owner's request and should come out on any objection. This project is not affiliated with Kraken, and the demo is not financial advice.

### PX4 Flight Review log (`drone-flight-3d`)

`downloads/px4-flight-review/4b7bf5df-6bdb-4815-be4c-070a3c520d60.ulg` is a public log from PX4 Flight Review (https://review.px4.io/plot_app?log=4b7bf5df-6bdb-4815-be4c-070a3c520d60), uploaded by a user we cannot name. Flight Review offers uploaders the option "Make this log publicly available under CC-BY PX4 license", linked to https://creativecommons.org/licenses/by/4.0/. We rely on that. Credit: "PX4 Flight Review log 4b7bf5df-6bdb-4815-be4c-070a3c520d60, uploaded to review.px4.io by its owner, CC BY 4.0. Used unmodified; the scene is our own derived visualisation." Flight Review warns that logs may contain location data. This log contains GPS latitude and longitude, and the raw file is in this public repository. The scene only shows metres relative to home. If the uploader or anyone else asks, the file will be removed.

### PX4 pyulog sample (`drone-flight-3d`)

`downloads/px4-pyulog/sample.ulg` is `test/sample.ulg` from https://github.com/PX4/pyulog (last changed in commit `820565a`). It is used only to test the ULog reader. The pyulog licence file could not be read when this page was written, so the licence is unconfirmed.

### Jaeger Project (`otel-trace-3d`)

Test traces from https://github.com/jaegertracing/jaeger (commit `22e560d`) and a fixture from https://github.com/jaegertracing/jaeger-ui (commit `b9fb749`), both Apache License 2.0. The licence text is in `docs/demos/otel-trace-3d/v1/downloads/LICENSE-jaeger-Apache-2.0`. Jaeger's NOTICE file reads:

> Jaeger, Distributed Tracing Platform.
>
> Copyright 2015-2019 The Jaeger Project Authors
>
> Licensed under Apache License 2.0. See LICENSE for terms.
>
> Includes software developed at Uber Technologies, Inc. (https://eng.uber.com/).

jaeger-ui has no NOTICE file. The files were fetched and are included unmodified, with their sources and hashes listed in the demo README. The OpenTelemetry Demo trace was captured by the Jaeger maintainers from the OpenTelemetry Demo (https://github.com/open-telemetry/opentelemetry-demo, Apache-2.0).

## MIT licence text (Langfuse and Foxglove)

Copyright (c) 2023-2026 ClickHouse, Inc. (Langfuse)
Copyright (c) Foxglove Technologies Inc (foxglove/mcap)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
