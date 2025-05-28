import express from 'express';
import { PrismaClient } from '@prisma/client';
import { identifyContact } from './controllers/identify';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

app.post('/identify', async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;
    const result = await identifyContact({ email, phoneNumber });
    res.json(result);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
