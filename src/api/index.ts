import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { client, graphql } from "ponder";
import { statsRoutes } from "./stats";

const app = new Hono();

// forgecapita-api reads Postgres directly and the frontend only POSTs GraphQL,
// so nothing legitimate needs the generic read-only SQL endpoint. It lets any
// caller run arbitrary SELECTs over the whole indexed dataset, so it is off by
// default and can never be enabled in production (fail closed). Local debugging
// only: ENABLE_SQL_API=true with NODE_ENV !== "production".
const sqlApiEnabled =
  process.env.ENABLE_SQL_API === "true" && process.env.NODE_ENV !== "production";
if (sqlApiEnabled) {
  app.use("/sql/*", client({ db, schema }));
}

// Shared GraphQL abuse limits, applied to both mounts. The frontend's queries
// (forgecapita-frontend/lib/api.ts) are shallow (depth ~4, no aliases).
// Ponder hardcodes the page size cap (limit > 1000 throws); it is not configurable.
const GRAPHQL_OPTIONS = {
  maxOperationTokens: 1000,
  maxOperationDepth: 10,
  maxOperationAliases: 15,
};

const MAX_GRAPHQL_BODY_BYTES = 16 * 1024;

const graphqlBodyLimit = bodyLimit({
  maxSize: MAX_GRAPHQL_BODY_BYTES,
  onError: (c) => c.text("Payload too large", 413),
});

app.post("/", graphqlBodyLimit);
app.post("/graphql", graphqlBodyLimit);

app.use("/", graphql({ db, schema }, GRAPHQL_OPTIONS));
app.use("/graphql", graphql({ db, schema }, GRAPHQL_OPTIONS));

app.route("/", statsRoutes);

export default app;
