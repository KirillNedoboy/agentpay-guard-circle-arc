# Lepton Demo Video Script

## 0:00-0:20 Problem

AI agents may need premium or creator-owned sources, but they should not move toward payment decisions without a control layer. Builders need a deterministic way to check recipient trust, amount limits, scenario fit, and auditability before any paid source flow proceeds.

## 0:20-0:45 Product

This project is CitePay Agent. It is a local deterministic paid-source demo built on top of AgentPay Guard. The agent selects mock premium source cards, turns them into normal payment intents, and runs each intent through the existing Guard API before any payment rail is used.

## 0:45-1:45 Demo Walkthrough

Here the app starts from a built-in Lepton/CitePay preset. The user question is: "Need weather risk, climate claims, telemetry attestation, and private scrape cache context for an insurance answer." The budget is `0.24 USDC`.

On the right is the mock source catalog. When I click `Select paid sources and evaluate Guard`, the agent deterministically selects relevant sources and skips the irrelevant one.

`Weather risk brief` is selected and gets `ALLOW`.

`Climate claims dataset` is selected and gets `REVIEW`.

`Blocked scrape cache` is selected and gets `BLOCK`.

`Telemetry attestation note` is selected and gets `REVIEW`.

`Market data note` is skipped as `not_relevant`.

At the top, the UI shows proposed spend `0.24 USDC` and allowed spend `0.08 USDC`.

## 1:45-2:20 Guard / Audit / Payment-Safety Angle

The important part is that CitePay Agent does not bypass the Guard. Each selected source becomes a normal AgentPay Guard payment intent and is evaluated through `POST /api/payment-intents/evaluate`. The Guard returns `ALLOW`, `REVIEW`, or `BLOCK`, and the existing audit layer writes or reuses a JSONL audit record. This keeps the payment-safety logic explicit before any future payment rail would exist.

## 2:20-2:45 Lepton / RFB Fit

The fit here is an agent workflow that wants premium retrieval or paid citations but still needs deterministic controls. CitePay Agent shows a concrete agent use case for paid-source selection plus policy and audit checks. It is a builder-facing proof for guarded agent payments, not a live payment product.

## 2:45-3:00 Limitations / Next Step

This is still a local deterministic demo. There are no real payments, no wallet signing, and no live Circle, x402, or Arc integration in this branch. The next safe step is packaging the existing proof-pack, screenshots, and submission materials without changing the product boundary.
