---
slug: customer
tags: [entity, commerce, core]
relationships:
  relates-to: order
---

# Customer

A Customer is a registered user who can place orders.

## Attributes
- name: string (required)
- email: string (unique)

## Behavior
- Can place multiple [[order]]s
- Has a loyalty tier based on purchase history
