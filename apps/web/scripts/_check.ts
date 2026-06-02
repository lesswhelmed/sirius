import { prisma } from "@repo/db";

const counts = {
  users: await prisma.user.count(),
  usersWithHandle: await prisma.user.count({ where: { handle: { not: null } } }),
  posts: await prisma.post.count(),
  postsSocial: await prisma.post.count({ where: { type: "SOCIAL" } }),
  postsPublishedSocial: await prisma.post.count({
    where: { type: "SOCIAL", status: "PUBLISHED" },
  }),
  postsWithSubmitter: await prisma.post.count({
    where: { submittedById: { not: null } },
  }),
  tags: await prisma.tag.count(),
  categories: await prisma.category.count(),
};
console.log(counts);
process.exit(0);
