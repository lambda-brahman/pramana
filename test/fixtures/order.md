---
slug: order
summary: "A customer's intent to purchase one or more products"
aliases: [purchase-order, sales-order, transaction]
tags: [entity, commerce, core]
relationships:
  depends-on: [customer, line-item, shipping-info]
---

# Order

An Order represents a customer's intent to purchase.

## Attributes
- lineItems: [[line-item]][] (at least one required)
- customer: [[depends-on::customer]] reference

## Rules
- Total equals sum of [[depends-on::line-item#pricing]] values
- Must have valid [[shipping-info]]
