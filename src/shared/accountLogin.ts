import { z } from 'zod';

export const accountPasswordLoginSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(128),
}).strict();
export type AccountPasswordLogin = z.infer<typeof accountPasswordLoginSchema>;
