import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface IdentifyInput {
  email?: string;
  phoneNumber?: string;
}

export const identifyContact = async ({ email, phoneNumber }: IdentifyInput) => {
  if (!email && !phoneNumber) {
    throw new Error("At least one of email or phoneNumber is required");
  }

  // STEP 1: Get all contacts matching email or phone number
  const matchedContacts = await prisma.contact.findMany({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phoneNumber ? [{ phoneNumber }] : []),
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  let allLinkedContacts: any[] = [];

  if (matchedContacts.length > 0) {
    const allContactIds = matchedContacts.map((c) => c.id);
    allLinkedContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { linkedId: { in: allContactIds } },
          { id: { in: allContactIds } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // If no match exists, create a new primary contact
  if (allLinkedContacts.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: 'primary',
        linkedId: null,
      },
    });

    return {
      contact: {
        primaryContatctId: newContact.id,
        emails: email ? [email] : [],
        phoneNumbers: phoneNumber ? [phoneNumber] : [],
        secondaryContactIds: [],
      },
    };
  }

  // STEP 2: Resolve oldest primary contact
  let oldestPrimary;

  const primaryContacts = allLinkedContacts.filter(
    (c) => c.linkPrecedence === 'primary'
  );

  if (primaryContacts.length > 0) {
    oldestPrimary = primaryContacts.sort(
      (a, b) => +a.createdAt - +b.createdAt
    )[0];
  } else {
    // If all are secondary, use linkedId to find the primary
    const linkedPrimaryId = allLinkedContacts[0].linkedId;
    if (!linkedPrimaryId) {
      throw new Error("Data inconsistency: secondary without linkedId");
    }
    oldestPrimary = await prisma.contact.findUnique({
      where: { id: linkedPrimaryId },
    });
  }

  // STEP 3: Demote other primaries to secondary
  const primariesToDemote = primaryContacts.filter(
    (c) => c.id !== oldestPrimary.id
  );

  for (const contact of primariesToDemote) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        linkPrecedence: 'secondary',
        linkedId: oldestPrimary.id,
      },
    });
  }

  // STEP 4: If email or phone partially matches, insert a new secondary contact
  const fullMatchExists = allLinkedContacts.some(
    (c) =>
      (email ? c.email === email : true) &&
      (phoneNumber ? c.phoneNumber === phoneNumber : true)
  );

  const emailExists = email && allLinkedContacts.some((c) => c.email === email);
  const phoneExists =
    phoneNumber && allLinkedContacts.some((c) => c.phoneNumber === phoneNumber);

  if (!fullMatchExists && (emailExists || phoneExists)) {
    const alreadyExists = await prisma.contact.findFirst({
      where: {
        email,
        phoneNumber,
      },
    });

    if (!alreadyExists) {
      await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: 'secondary',
          linkedId: oldestPrimary.id,
        },
      });
    }
  }

  // STEP 5: Fetch the final list of contacts
  const finalContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: oldestPrimary.id },
        { linkedId: oldestPrimary.id },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  const emails = [...new Set(finalContacts.map((c) => c.email).filter(Boolean))];
  const phoneNumbers = [
    ...new Set(finalContacts.map((c) => c.phoneNumber).filter(Boolean)),
  ];
  const secondaryContactIds = finalContacts
    .filter((c) => c.linkPrecedence === 'secondary')
    .map((c) => c.id);

  return {
    contact: {
      primaryContatctId: oldestPrimary.id,
      emails,
      phoneNumbers,
      secondaryContactIds,
    },
  };
};
