import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['warn', 'error'], // keep logs quiet but useful
});

export default prisma;
