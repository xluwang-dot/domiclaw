import { initDatabase, rebuildAllEmbeddings } from "../src/db.js";

async function main() {
  console.log("Initializing database...");
  initDatabase();

  console.log("Generating embeddings for all KPs without vectors...");
  const count = await rebuildAllEmbeddings();
  console.log(`Done. ${count} embeddings generated.`);
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
