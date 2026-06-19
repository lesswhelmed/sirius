import { prisma } from "@repo/db";

const p = await prisma.post.findUnique({
	where: { slug: "ig-dyfmu4-cbhc" },
	select: { content: true, imageUrl: true },
});
console.log("imageUrl:", p?.imageUrl);
console.log("---content start---");
console.log(p?.content);
console.log("---content end---");
process.exit(0);
