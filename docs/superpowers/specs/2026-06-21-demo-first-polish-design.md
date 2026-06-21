# AgentPay Guard Demo-First Polish

Date: 2026-06-21
Project: `/root/projects/citepay-agent`
Status: approved in chat for immediate implementation

## Goal
Tighten the already-implemented hybrid redesign specifically for hackathon demo capture on a phone.

## Changes
1. Add a single dominant hero CTA: `Run demo`.
2. Add a compact above-the-fold outcome/proof band with:
   - current decision state;
   - one-line reason;
   - audit trace id.
3. Shorten CTA and helper copy where possible.
4. Collapse secondary content by default:
   - skipped sources;
   - full audit log;
   - validator mode.
5. Increase visual emphasis for decision/result over raw form density.

## Non-goals
- no backend logic changes
- no policy engine changes
- no API changes
- no data model changes

## Verification target
After implementation, the first screen should make the demo path obvious:
- understand product
- tap one main button
- see decision/proof quickly
- optionally expand details below
