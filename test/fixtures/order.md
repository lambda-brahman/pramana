---
slug: order
tags: [entity, commerce, core]
relationships:
  needs: customer
  has: [line-item, shipping-info]
---

# Order

An Order represents a customer's intent to purchase.

## Attributes
- lineItems: [[line-item]][] (at least one required)
- customer: [[needs::customer]] reference

## Rules
- Total equals sum of [[needs::line-item#pricing]] values
- Must have valid [[shipping-info]]
