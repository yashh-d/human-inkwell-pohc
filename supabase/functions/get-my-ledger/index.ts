// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAddress, verifyMessage } from "https://esm.sh/ethers@6.13.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_AGE_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const { message, signature, author_address } = (await req.json()) as {
      message?: string;
      signature?: string;
      author_address?: string;
    };
    if (!message || !signature || !author_address) {
      return new Response(JSON.stringify({ error: "Missing message, signature, or author_address" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const recovered = verifyMessage(message, signature);
    if (getAddress(recovered) !== getAddress(author_address)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const m = message.match(/time:(\d+)/);
    if (!m) {
      return new Response(JSON.stringify({ error: "Invalid message format" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const t = parseInt(m[1], 10);
    if (Date.now() - t > MAX_AGE_MS) {
      return new Response(JSON.stringify({ error: "Message expired, sign again" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const expectedPrefix = "Human Inkwell list submissions\n";
    if (!message.startsWith(expectedPrefix)) {
      return new Response(JSON.stringify({ error: "Invalid message prefix" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const addr = getAddress(author_address).toLowerCase();
    const { data, error } = await supabase
      .from("ledger_submissions")
      .select(
        "chain_id, contract_address, entry_id, author_address, transaction_hash, content_hash, human_signature_hash, world_id_nullifier, is_verified, keystroke_count, typing_speed_scaled, block_number, block_timestamp, gas_used, created_at"
      )
      .eq("author_address", addr)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, rows: data ?? [] }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
