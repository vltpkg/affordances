# Affordances protocol, version 1 (draft)

> Draft. When it's done, this replaces [version 0](spec.md). [Open issues](#open-issues) are listed at the end.

Affordances lets an agent read and operate a website through the same URLs a person uses, with the same session. Everything an agent reads is a resource: a JSON document with an address, its own data, links to other resources, and the actions its reader may take. A page answers in HTML for browsers and as a resource for agents. Performing an action is one HTTP request, which the action describes the way MCP describes a tool.

The format is the one the [vlt.io](https://vlt.io) API serves. A JSON API and a website with pages are the same thing to a client: resources, links and actions.

This document is normative, except for sections marked non-normative. The key words "must", "must not", "should", and "may" are used as in RFC 2119. JSON Schemas are JSON Schema 2020-12 and may omit `$schema`.

It builds on HTTP Semantics (RFC 9110), URI (RFC 3986), URI Template (RFC 6570), JSON Merge Patch (RFC 7396), Problem Details for HTTP APIs (RFC 9457), Structured Field Values for HTTP (RFC 9651), and JSON Pointer (RFC 6901).

## Resources

```ts
type Resource = {
  $id: string // the resource's URL
  $schema?: string // the URL of a JSON Schema that describes it
  links?: Record<string, Link | Link[]>
  actions?: Record<string, Action>
  [property: string]: unknown // the resource's own data
}
```

```json
{
  "$id": "/products/heavyweight-tee",
  "title": "Heavyweight Tee",
  "product": {
    "name": "Heavyweight Tee",
    "price": { "amount": 4800, "currency": "USD" },
    "variants": [
      { "sku": "TEE-BLK-M", "size": "M", "stock": 12 },
      { "sku": "TEE-BLK-L", "size": "L", "stock": 0 }
    ]
  },
  "cart": {
    "$id": "/cart",
    "count": 1,
    "subtotal": { "amount": 1200, "currency": "USD" },
    "links": {
      "checkout": { "$ref": "/checkout", "title": "Check out" }
    }
  },
  "links": {
    "search": { "$ref": "/search{?q}", "templated": true, "title": "Search the catalog" },
    "alternate": { "$ref": "/products/heavyweight-tee.md", "type": "text/markdown" }
  },
  "actions": {
    "cart.addItem": {
      "$ref": "/products/heavyweight-tee?action=cart.addItem",
      "method": "POST",
      "title": "Add to cart",
      "description": "Add a product variant to the cart. The variant must be in stock.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sku": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 }
        },
        "required": ["sku"]
      }
    },
    "product.notifyWhenInStock": {
      "$ref": "/products/heavyweight-tee?action=product.notifyWhenInStock",
      "method": "POST",
      "description": "Email me when a sold-out variant is back",
      "available": false,
      "reason": "Sign in to get notified"
    }
  }
}
```

- `$id` is the resource's URL. A `GET` of it returns the resource. `$id`, `$schema` and every `$ref` are URI references, resolved against the URL the document was requested from.
- `$schema`, `links` and `actions` belong to the format. Every other member is the resource's own data.
- A member whose value is an object with an `$id` is a resource too, with its own links and actions, such as the cart above or the items of a collection. An object without an `$id` is data.
- A resource must not contain anything the HTML page at the same URL would not show the same reader.
- A relation that doesn't exist is left out. A link or an action is never `null`. Because a [delta](#delta) uses `null` to remove a member, data should leave a member out rather than set it to `null`.
- A resource should stay small. About 2,000 tokens is a good ceiling. A long list is a resource of its own, linked to.

## Media type

A resource is sent as `application/vnd.affordances+json`. Errors are sent as `application/problem+json`.

A URL that has another representation, such as an HTML page, must not return a resource for a request that did not ask for one. A JSON API whose URLs serve nothing else may send its resources as `application/json`.

## Discovery

**Per page.** A client requests the page's own URL with `Accept: application/vnd.affordances+json`. The server responds with the page's resource, or `404` if the page has none.

HTML responses for pages with a resource should advertise it as an alternate representation, in both places:

```http
Link: <?affordances=1>; rel="alternate"; type="application/vnd.affordances+json"
```

```html
<link rel="alternate" type="application/vnd.affordances+json" href="?affordances=1" />
```

`?affordances=1` is an alias for the `Accept` header, for clients that cannot set headers. A server that supports it must treat `GET <url>?affordances=1` like `GET <url>` with the Affordances `Accept` header, and must leave `affordances` out of the resource's `$id` and of the query it gives the page's state.

**Per site.** `GET /.well-known/affordances.json` returns the [site document](#the-site-document).

**Caching.** A shared cache must never serve one representation for the other. Resources that depend on the reader send `Vary: Accept` and `Cache-Control: private, no-store`, and a server must make sure cached HTML is keyed on `Accept` too.

## Links

```ts
type Link = {
  $ref: string // a URI reference, or an RFC 6570 template when templated
  templated?: boolean
  title?: string
  type?: string // the media type to expect
}
```

Each key in `links` names the relationship to the target. A site chooses its names. Where the IANA link relation registry has a name for the relationship, such as `next`, `previous`, `first`, `search` or `alternate`, a site should use it.

- A relation that can have more than one link should always have an array, even when it holds one link.
- A templated `$ref` is expanded first, as RFC 6570 specifies; variables the client doesn't set are left out.
- A link the reader can't use is left out. A resource is built for one reader, so it has no conditional links.
- Links should have a `title` unless the name alone says where they lead. Agents choose links by title as often as by name.
- Reads are links. A search or a filter is a templated link that an agent expands and requests, not an action.

## Actions

```ts
type Action = {
  $ref: string // the URL the request is sent to
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  title?: string
  description?: string
  inputSchema?: JSONSchema // the request body; its root is { type: 'object' }
  outputSchema?: JSONSchema
  annotations?: { consequentialHint?: boolean }
  available?: boolean // false: the reader may, but not right now
  reason?: string // why not
}
```

An action is a link with a method and a body. Its key in `actions` is its name.

`title`, `description`, `inputSchema`, `outputSchema` and `annotations` mean what they mean in an MCP tool definition, so an action becomes an MCP or WebMCP tool without translation (see [Mapping to MCP and WebMCP](#mapping-to-mcp-and-webmcp)).

- **Names.** A name identifies one operation across the whole site, as a link's name identifies one relationship. It has the form `<resource>.<verb>`: `cart.addItem`, `order.place`. Names must match `^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$` and be at most 128 characters, which fits the tool-name rule WebMCP enforces and MCP recommends. Names should be stable across releases.
- **Where it sits.** An action is listed on the resource it changes. An action that creates something is listed on the collection it adds to.
- **Who sees it.** An action the reader may never perform is left out. An action the reader may perform, but not right now, is listed with `available: false` and a `reason` written for a person, such as an out-of-stock variant or a caller who has to sign in first. An action without `available` is available.
- **`inputSchema`** is left out when the request has no body.
- **`annotations`** holds tool annotations with the names and meanings MCP and WebMCP give them. This version defines one: `consequentialHint`, from WebMCP, for an action a person must [confirm](#confirmation). The request's method already says whether the action is idempotent (RFC 9110), so no annotation repeats it. Annotations are hints: a client must not rely on them for safety.
- **Everything but `$ref`, `available` and `reason`** describes the kind of action, and is the same on every resource that lists it. A server may leave `title`, `description`, `inputSchema`, `outputSchema` and `annotations` out of a resource when it serves the action's [definition](#action-definitions).

An action that is not meant for agents is not part of the protocol. It must not appear in resources or definitions, and requests for it must fail.

## Performing an action

```http
POST /products/heavyweight-tee?action=cart.addItem
Content-Type: application/json

{ "sku": "TEE-BLK-M" }
```

Performing an action is one request: the action's `method`, sent to its `$ref`, with a JSON body that matches its `inputSchema`. A client must not build the URL any other way. An action without an `inputSchema` is sent without a body.

The server processes the request in this order, and stops at the first failure:

1. Find the action by the request's URL and method. Failure: `404`, or `405` with `Allow`.
2. Check the origin rule in [Security](#security). Failure: `403`.
3. Check that the caller may perform the action. Failure: `401` or `403`.
4. Apply the rate limit. Failure: `429`.
5. Parse the body and validate it against `inputSchema`. Failure: `400` for a body that isn't JSON, [`invalid-input`](#problems) otherwise.
6. Check that the action is available for this input. Failure: `unavailable`.
7. For an action with `consequentialHint`, check the [confirmation](#confirmation). Failure: `confirmation-required`. Nothing runs.
8. Run the action and respond.

What a successful request answers depends on what the action did:

| Outcome                         | Response                                                        |
| ------------------------------- | --------------------------------------------------------------- |
| The resource changed            | `200` with a [delta](#delta), or with the resource as it is now |
| Something new was created       | `201`, with its URL in `Location`                               |
| The resource is gone            | `204`                                                           |
| The person would be sent onward | `303`, with the URL in `Location`                               |

When an action has an `outputSchema`, it describes the body of a `200` or `201` response that is not a delta, and the `output` of one that is.

## Delta

A page's actions change a little of a page the agent has already read. A delta says what changed, so the agent doesn't read the page again.

```ts
type Delta = {
  patch?: object // an RFC 7396 merge patch to the resource
  output?: unknown
  message?: string
}
```

A delta is sent as `application/vnd.affordances.delta+json`. Removing the last item from the cart:

```http
POST /cart?action=cart.updateQuantity
Content-Type: application/json

{ "sku": "TEE-BLK-M", "quantity": 0 }
```

```json
{
  "patch": {
    "items": [],
    "count": 0,
    "subtotal": { "amount": 0 },
    "links": { "checkout": null },
    "actions": {
      "cart.updateQuantity": { "available": false, "reason": "Your cart is empty" },
      "cart.removeItem": { "available": false, "reason": "Your cart is empty" }
    }
  },
  "message": "Removed Heavyweight Tee (M) from the cart"
}
```

- `patch` takes the resource the action is listed on from what it was before the action ran to what it is after, by RFC 7396. It covers the whole resource: its data, its links, its actions and their availability, and the resources inside it. It is left out when nothing changed. A client applies it to its copy; a client whose copy may be older than the request should read the resource again.
- `output` is the action's return value. When the action has an `outputSchema`, `output` must match it.
- `message` is a short sentence suitable to repeat to the person.

A server may answer `200` with the whole resource instead, as `application/vnd.affordances+json` or `application/json`. The media type tells a client which one it got.

## Problems

Every error is an RFC 9457 problem, sent as `application/problem+json`. A client must accept that media type on every request.

The protocol defines three problem types. Their URIs are `https://spec.affordances.example/problems/<name>` until the spec has a permanent home.

| Type                    | Status | Title                 | When                                                       | Extension members |
| ----------------------- | ------ | --------------------- | ---------------------------------------------------------- | ----------------- |
| `invalid-input`         | 422    | Invalid input         | The body doesn't match the action's `inputSchema`          | `errors`          |
| `unavailable`           | 409    | Action unavailable    | The action can't run now; `detail` says why                |                   |
| `confirmation-required` | 409    | Confirmation required | The action needs the person's approval; `detail` says what | `confirmation`    |

Every other failure uses the type `about:blank`, which adds nothing to the status code, with a `detail` that says what went wrong:

| Status | When                                                           |
| ------ | -------------------------------------------------------------- |
| 400    | The body is not JSON                                           |
| 401    | The action needs a session the request doesn't have            |
| 403    | The caller may not, or a cookie arrived without its `Origin`   |
| 404    | The URL has no resource or action                              |
| 405    | The URL doesn't take that method. The response carries `Allow` |
| 429    | Too many requests. The response should carry `Retry-After`     |
| 500    | The action threw. `detail` must not leak internals             |

A `401` must carry `WWW-Authenticate`, as RFC 9110 requires: `Bearer`, when the server accepts bearer tokens.

`invalid-input` lists each problem in `errors`, as RFC 9457's own example does. Each has a `detail` and a `pointer`, a JSON Pointer into the request body:

```json
{
  "type": "https://spec.affordances.example/problems/invalid-input",
  "title": "Invalid input",
  "status": 422,
  "detail": "The input doesn't match the action's schema",
  "errors": [{ "detail": "Expected an integer of 0 or more", "pointer": "#/quantity" }]
}
```

## Confirmation

An action marked `consequentialHint: true` is one a person should approve: placing an order, sending a message, deleting data. A request for it that doesn't carry a valid confirmation runs nothing. The server answers `confirmation-required`: `detail` is a summary of what the request will do, written for the person who approves it, and `confirmation` is an opaque token.

```json
{
  "type": "https://spec.affordances.example/problems/confirmation-required",
  "title": "Confirmation required",
  "status": 409,
  "detail": "Place an order for 2 items totalling $60.00",
  "confirmation": "cf_8Kq2xVn4Lr7Tz"
}
```

A client acting for a person shows the summary. Once the person approves, it sends the same request again, with the token in the `Affordances-Confirmation` header, a Structured Field token (RFC 9651):

```http
POST /checkout?action=order.place
Content-Type: application/json
Affordances-Confirmation: cf_8Kq2xVn4Lr7Tz

{}
```

The server must run the action only when the token was issued to the same session, for the same action and input, and the summary it would show now is the same one. Otherwise it answers `confirmation-required` again, with a new summary and token. Tokens should expire after a few minutes.

So what runs is what the person approved. A client can't get approval for one input and send another, and a change that alters the summary, such as the cart's total, asks again.

A server can check tokens without storing them: sign the session, the action's name, the validated input (canonicalized, for example with RFC 8785), the summary, and an expiry time with a key only it knows. (Non-normative.)

A server may confirm another way that proves a person approved, such as a one-time password in a header its `401` names in `WWW-Authenticate`. The action is marked `consequentialHint` all the same.

## Action definitions

A client that offers actions as tools needs to know every action before it has read a resource. A site serves each action's definition as a resource, in a collection the site document links to.

```ts
type ActionDefinition = {
  $id: string
  name: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  title?: string
  description: string
  inputSchema?: JSONSchema
  outputSchema?: JSONSchema
  annotations?: { consequentialHint?: boolean }
  links: {
    // the kind of resource that lists the action
    'resource-schema'?: Link // its JSON Schema
    resource?: Link // its URL, as a template
  }
}
```

```json
{
  "$id": "/.well-known/affordances/action",
  "items": [
    {
      "$id": "/.well-known/affordances/action/cart.addItem",
      "name": "cart.addItem",
      "method": "POST",
      "title": "Add to cart",
      "description": "Add a product variant to the cart. The variant must be in stock.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sku": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 }
        },
        "required": ["sku"]
      },
      "links": {
        "resource": { "$ref": "/products/{slug}", "templated": true, "title": "One product" }
      }
    }
  ]
}
```

A definition has no `$ref`, `available` or `reason`: those belong to the action on one resource, for one reader. A definition must name the kind of resource that lists the action, by its schema, by its URL template, or both. An action several kinds of resource list has an array of links.

A definition is enough to plan with, not to act on. To perform an action a client reads a resource that lists it and sends the request the action there describes.

## The site document

`GET /.well-known/affordances.json` returns a resource that describes the site:

```json
{
  "$id": "/.well-known/affordances.json",
  "title": "Acme Store",
  "auth": ["cookie", "bearer"],
  "links": {
    "start": { "$ref": "/", "title": "The storefront" },
    "action-definition-collection": { "$ref": "/.well-known/affordances/action" },
    "mcp": { "$ref": "https://acme.example/mcp" }
  }
}
```

- `auth` lists how a caller can authenticate: `cookie`, `bearer`, or both.
- `start` is the resource to read first.
- `action-definition-collection` is the collection of [action definitions](#action-definitions).
- `mcp` is the URL of an MCP endpoint for the site, when it has one.

## Security

- Default deny. Only actions the site's author exposed to agents are part of the protocol.
- A request that authenticates by cookie must carry an `Origin` header that matches the site. A request with `Authorization: Bearer` is exempt. A server must not rely on its framework's own protections for these requests.
- An action marked `consequentialHint` must not run without a valid confirmation. Clients acting for a person must show the summary and get approval first.
- Input is validated before availability is checked, and availability is checked before the action runs.
- URLs must not carry personal data. A resource must not include data that the HTML page would not show to the same reader.
- A client sends its credentials only to the site's own origin. A `$ref` that leads elsewhere is followed without them.

## Versioning

This is major version 1. Responses carry it as the media type's `v` parameter: `application/vnd.affordances+json; v=1`. A client may ask for a major version the same way in `Accept`; a server that can't serve it answers `406`. A request without `v` gets the newest major the server supports.

A breaking change ships as a new major version. Additive changes, such as new optional members, may ship within a major version, and clients must ignore members they don't recognize.

## Mapping to MCP and WebMCP

Non-normative. An action is a tool definition with an address, so it maps onto both.

| Format                        | MCP                                                   | WebMCP (`document.modelContext`)              |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| an action definition          | a tool                                                | a tool, registered while a page lists it      |
| the action's name             | `name`                                                | `name`                                        |
| `title`, `description`        | `title`, `description`                                | `title`, `description`                        |
| `inputSchema`                 | `inputSchema`, with `$ref`s to other URLs bundled     | `inputSchema`, bundled                        |
| no `inputSchema`              | `{ "type": "object", "additionalProperties": false }` | left out                                      |
| `outputSchema`                | `outputSchema`                                        | `outputSchema`                                |
| `method`                      | `idempotentHint` for `PUT` and `DELETE`               |                                               |
| `consequentialHint`           | confirm through elicitation                           | `consequentialHint`                           |
| the resource's `$id`          | a `target` argument                                   | a `target` argument when a page lists several |
| absent, or `available: false` | the call answers `isError` with the `reason`          | not registered                                |
| a delta's `output`, or a body | `structuredContent`                                   | the value `execute` returns                   |
| a problem                     | a result with `isError: true`                         | a rejected promise                            |
| `Location`, a link            | a `resource_link`                                     |                                               |

MCP's tool list may not change from one request to the next, so a bridge lists a tool for every definition and takes the resource as an argument. It performs a call by reading that resource, finding the action by name, and sending the request the action describes. A bridge never builds a URL.

WebMCP registers tools per document. A page registers the actions of the resources it shows, and unregisters them by aborting the signal it registered them with. `execute` cannot ask the person anything, so a consequential action confirms in the page's own interface.

## Changes from version 0

Non-normative.

- A graph becomes a resource. `page` becomes `$id`, and `entities` become the resource's own members. A member with an `$id` is a resource with its own links and actions.
- `nav` becomes `links`, keyed by name, with `$ref`. `nav[].when` is gone: a resource is built for one reader, so links that don't apply are left out.
- `actions` is an object keyed by name instead of an array, and names are unique across the site instead of per route. Each action has a `$ref` and a `method`. `input` and `output` become `inputSchema` and `outputSchema`, and actions gain `title` and `annotations`.
- A call is the action's own request, with the input as its body, instead of `{ action, input, confirm }` posted to the page.
- `expose` is gone from the wire. An action the reader may never perform is left out, and one that needs a session they don't have is listed with `available: false`. `expose: 'confirm'` becomes `consequentialHint`. `readOnly` is gone: reads are links.
- `guard`, the human-readable precondition, moves into `description`. `effects` is gone: the delta's patch says what changed.
- `confirm: true` becomes a token bound to the session, the action, the input and the summary, sent in a header.
- A delta's `ok`, `changed`, `actionsAdded` and `actionsRemoved` become one merge `patch`. `redirect` becomes a `303`.
- Errors are RFC 9457 problems instead of `{ ok: false, error }`, and `issues` becomes `errors` with JSON Pointers. A failed origin check answers `403` instead of `401`, and `401` carries `WWW-Authenticate`.
- `v` moves from the body into the media type.
- HTML advertises the resource with `rel="alternate"` and its media type, instead of `rel="affordances"`.
- The site index becomes the site document and the collection of action definitions. `route` is gone from resources: a definition names the URL template of the resources that list it.

## Open issues

1. **Reads with typed input.** A search is a templated link, so its parameters have names and no types or descriptions, and it doesn't become a tool. An action with `method: "GET"`, whose input becomes the query string, would give reads the same description as writes. Version 1 has none yet.
2. **Deltas and whole resources.** An action may answer with a delta or with the resource, told apart by media type. A client has to handle both. Requiring one, or letting the client choose with `Accept`, would be simpler to implement against.
3. **A home for the URIs.** Problem types use an `.example` placeholder, and `/.well-known/affordances.json` is not registered, as RFC 8615 asks.
4. **Members that left the wire.** `guard` and `effects` told an agent, before it called, what an action needs and what it changes. Version 1 leaves the first to `description` and the second to the delta. If agents plan worse without them, they come back as members of the definition.
5. **The action's URL.** A page's actions share the page's URL in version 0. Version 1 gives each a `$ref`, and the examples use `?action=<name>`. The protocol doesn't fix that form, but a framework has to choose one that its router and its caches treat as distinct from the page.
6. **Stale copies.** A patch is relative to the resource just before the action ran, which may be newer than the client's copy. Resources could carry an `ETag`, and deltas could name the version they patch.
7. **Pages with no resource.** `404` is right for an unknown URL. For a page that exists only as HTML, `406 Not Acceptable` would be more accurate, but a server that routes Affordances requests separately may not know which case it's in.
8. **MCP's other annotations.** `destructiveHint` and `openWorldHint` default to true in MCP, so a bridge that says nothing marks every action destructive and open-world. They are left out here until a site needs to say otherwise.
