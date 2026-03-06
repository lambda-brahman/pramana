# Example Knowledge Bases

Three ready-to-use knowledge bases showing how Pramana works with different domains.

## Law — Tort Law Basics

Four artifacts covering the elements of negligence in tort law. Demonstrates a dependency chain: negligence depends on duty of care, breach, and causation.

```
/pramana:setup ./examples/law
"What is negligence?"
"What does negligence depend on?"
```

## Recipes — Cooking Techniques & Dishes

Four artifacts showing how cooking techniques build on each other. Roux is the foundation, bechamel depends on it, and both lasagna and mac-and-cheese depend on bechamel.

```
/pramana:setup ./examples/recipes
"How do I make lasagna from scratch?"
"What do I need to know before making bechamel?"
```

## Software Architecture — Microservices

Four artifacts modeling a microservice system. The API gateway depends on auth and rate limiting, while auth relates to the user service.

```
/pramana:setup ./examples/architecture
"What happens when a request hits the API gateway?"
"What services does the API gateway depend on?"
```

## Try any example

Pick a domain and run:

```
/pramana:setup ./examples/<domain>
```

Then ask questions naturally, or use the query skill directly:

```
/pramana:query "your question here"
```
