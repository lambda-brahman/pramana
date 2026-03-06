---
slug: line-item
tags: [entity, commerce]
relationships:
  part-of: order
---

# Line Item

A Line Item represents a single product entry in an order.

## Attributes
- product: string
- quantity: number
- unitPrice: number

## Pricing
- Total = quantity * unitPrice
- Discounts applied per [[discount-rule]] if applicable
