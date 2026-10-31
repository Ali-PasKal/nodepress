import type { Prisma } from '../../generated/prisma/client.js';

/** Either the root Prisma client or an interactive-transaction client. */
export type DbClient = Prisma.TransactionClient;
