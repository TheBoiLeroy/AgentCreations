// Local database commands.
//   corepack pnpm db migrate              create/upgrade the database
//   corepack pnpm db maintainer <handle>  let a signed-in account manage the skills catalog
//   corepack pnpm db where                print the database location
import { databaseUrl, one, openDatabase } from "../apps/web/lib/server/store/db";

const [command, arg] = process.argv.slice(2);
const db = await openDatabase();
try {
  if (command === "migrate") console.log(`Database ready: ${databaseUrl()}`);
  else if (command === "where") console.log(databaseUrl());
  else if (command === "maintainer" && arg) {
    const profile = await one<{ user_id: string }>(
      db,
      "select p.user_id from profiles p join users u on u.id = p.user_id where p.handle = ? and u.kind <> 'anonymous'",
      [arg.toLowerCase()],
    );
    if (!profile) throw new Error(`No signed-in profile @${arg}. Sign in on the site first.`);
    await db.execute({ sql: "insert into catalog_maintainers values (?) on conflict do nothing", args: [profile.user_id] });
    console.log(`@${arg.toLowerCase()} can now manage the skills catalog.`);
  } else {
    console.log("Usage: corepack pnpm db migrate | where | maintainer <handle>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
