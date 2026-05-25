## NZBHydra2 Frontend

This frontend is a standalone Next.js app.
The backend remains in Spring Boot and serves APIs/auth.

## Development

1. Install dependencies:

```bash
npm install
```

2. Set backend URL for same-origin route forwarding:

```bash
export NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:5076
```

3. Run dev server:

```bash
npm run dev
```

The frontend starts at http://localhost:3000 and redirects `/` to `/stats`.

## Production deployment

1. Build and run frontend:

```bash
npm run build
npm run start
```

2. Configure backend to point browser redirects to frontend host:

```properties
ui.frontend-url=https://your-ui-host.example
```

3. Configure backend CORS for UI origin:

```properties
ui.cors.allowed-origins=https://your-ui-host.example
```

4. Enable startup deployment checks in backend:

```properties
ui.production-mode=true
```

With `ui.production-mode=true`, backend startup fails if frontend URL or allowed CORS origins still use localhost/127.0.0.1 or wildcard origins.

## Backend Route Forwarding

Frontend calls backend paths directly on the same origin.

Example:

`/internalapi/stats`

forwards to

`$NEXT_PUBLIC_BACKEND_URL/internalapi/stats`

## Validation

```bash
npm run build
```
