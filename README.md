# UOM Forge

LLM-assisted domain modeling workbench for producing validated UOM/OAG domain models.

The project will encode a repeatable modeling methodology that helps domain experts
identify stable concepts, business objects, facts, relations, constraints, and
capabilities before describing business processes.

## Prototype

The first prototype is a browser-based modeling workbench. It keeps the working
document, ontology draft, activity list, assessment results, and conversation in
local browser storage. The built-in demo provider makes the workflow usable before
an LLM gateway is added.

```bash
npm install
npm run dev
```

The root `.env` contains server-side LLM settings for the future gateway. It is not
exposed to the browser. Browser-facing `VITE_*` variables can be added later when a
deliberate local-only provider is needed.
