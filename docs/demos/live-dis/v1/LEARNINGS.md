# Learnings from Live DIS v1 (Demo 85)

Each item is a candidate failure mode: what went wrong, what fixed it, and the evidence. Versions are those listed in `README.md`.

## 1. A node that parses is not a node that works

What went wrong: X_ITE 16.8.1 accepts all six DIS nodes with all 233 specification fields, with no warning in the console. Nothing else happens. `isActive` stays false, no socket is opened, and an EspduTransform draws its children at the origin whatever `translation` says.
Fix: test behaviour, not parsing. The definition of "live" in the README has four points and the same test is applied to every node.
Evidence: `tests/browser.test.js` test 1. A red box under an EspduTransform with `translation="6 0 0"` is drawn centred at pixel x 199.5 of 400. `RECEIPT.json`, `xite_alone`.

## 2. The reference implementation can be wrong

What went wrong: opendis 1.1.0 writes a Receiver PDU of 28 octets; the standard has 36. It has no fields for the receiver's own entity ID and radio ID. It also reads an articulation parameter value as an integer, does not pad Signal data to 32 bits, and its `UnknownAntennaPattern` writes N octets and reads N minus 6. open-dis 1.3.6 for JavaScript does not advance after a 64-bit read, so every Transmitter field after the frequency is wrong, and its Signal encoder does not write the data.
Fix: use two references and state, per PDU type, which one covers which fields. Never change the codec to agree with a reference without checking the PDU length against the standard first.
Evidence: comments and work-arounds in `tests/crosscheck_opendis.py` and `tests/crosscheck-open-dis-js.test.js`; README, "What this does not show".

## 3. outputOnly fields cannot be set through the SAI node object

What went wrong: `node.isActive = true` on an X_ITE SAI node does nothing for an outputOnly field, without an error.
Fix: `node.getValue().getField(name).setValue(value)`. This is internal API and may change with an X_ITE version; the vendored copy is pinned.
Evidence: `src/dis-runtime.js`, function `setOutput`; test 2 reads the fields back and follows ROUTEs from them.

## 4. Two events on one field in one frame become one

What went wrong: two entities arrived in the same frame. The second write to `addedEntities` replaced the first before the ROUTE ran, and one entity never appeared.
Fix: collect arrivals and departures and write each field once per frame.
Evidence: test 2 expects `addedEntities` to list both CUTTER 03 and HAWK 04.

## 5. ROUTE and Script outputs arrive one frame later

What went wrong: a test compared `TX.transmitState` with the Switch it is routed to in the same frame and failed now and then.
Fix: compare with a count tolerance and report the count. In the last run the routed value lagged in 2 of about 548 frames; the Script-driven turret lagged in 21.
Evidence: `RECEIPT.json`, `in_page`.

## 6. A fair comparison of algorithms needs the same flight

What went wrong: the first version switched the algorithm every few seconds and compared the error in each window. One window held a turn and another a straight leg, so the numbers ranked the flight, not the algorithm.
Fix: nine copies of the same aircraft, one per algorithm, sent at the same instants, plus an offline table over one full lap.
Evidence: test 3c and `tests/exercise.test.js`; the tables in the README.

## 7. A heartbeat interval hides short states

What went wrong: a writer node sent a PDU every `writeInterval` (2 s). The radio was keyed for 1.5 s at a time, and the listener sometimes never saw "transmitting".
Fix: radio writers also send at once when `transmitState` or `receiverState` changes.
Evidence: test 3a requires both states to be heard by opendis.

## 8. `node --test` runs test files in parallel

What went wrong: two test files used UDP at once and each received the other's PDUs. Also, `node --test tests/` with a directory argument did not run the files on Node 22.23.5.
Fix: `node --test --test-concurrency=1 tests/*.test.js`, and a separate port range and multicast group for `tests/gateway.test.js`.
Evidence: the full run passes 37 of 37 only with that flag.

## 9. A CommonJS file under `"type": "module"` can fail without a message

What went wrong: `tests/static-server.js` used `require`. Started as a child process with its output ignored, it died at once and the browser test timed out with no cause shown.
Fix: write every file as an ES module; pipe the child's stderr to the test output.
Evidence: `tests/static-server.js`.

## 10. A vendored viewer needs every file its profile asks for

What went wrong: with `profile="Immersive"` X_ITE fetched four more component files, a font and a wasm file. The first vendor copy held only the DIS component and the scene did not load.
Fix: copy the files the network log shows, then run with the network closed to anything but the page's own folder.
Evidence: `vendor/x_ite/assets/`; test 2 fails on any console error or failed request.

## 11. An angle from acos has a noise floor

What went wrong: the angle between two rotation matrices computed as acos((trace − 1)/2) gave about 3e-8 rad for equal matrices, which hid real errors of 1e-12.
Fix: use the Frobenius norm of the difference, which is linear near zero.
Evidence: `src/dis-dr.js`, `angleBetween`; the orientation column of the README table is now about 1e-14.

## 12. A package directory can shadow the standard library

What went wrong: Python started inside the opendis package directory imported `opendis/types.py` as the standard `types` module and failed in an unrelated place.
Fix: run the cross-check from the demo folder, never from inside a package.
Evidence: `tests/crosscheck_opendis.py` runs from the demo folder as the README shows.
