import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { generateSimulation } from "./simulation.server";

const inputSchema = z.object({
  business: z.string().max(200).default(""),
  focus: z.string().max(200).default(""),
  details: z.string().max(1500).default(""),
  scenario: z.string().max(300).default(""),
  language: z.enum(["en", "ar"]),
  mode: z.enum(["simulation", "solution"]),
});

export const runZyronexSimulation = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => generateSimulation(data));
