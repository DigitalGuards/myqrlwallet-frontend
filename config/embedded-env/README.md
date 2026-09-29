# Deliberately empty

`config/vite.config.embedded.ts` points Vite's `envDir` here.

The embedded document is shipped inside the mobile app, so its configuration
is committed in `src/config/embeddedProfile.ts` rather than read from a `.env`
on a deployment host. Pointing `envDir` at a directory that holds no `.env`
files means a stray `.env` in the repository root cannot change what the
shipped document is built with.

Do not add a `.env` file here.
