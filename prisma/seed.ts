import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Demo catalogue seed.
 *
 * Every product created here is marked `source = "pexels"`. That marker is the
 * launch gate (SEC-27): purging demo data before go-live is a single
 * `deleteMany({ where: { source: "pexels" } })`.
 */

// SEC-27: refuse to run against a production environment, before anything else.
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "Refusing to seed: NODE_ENV=production. This script writes demo data and " +
      "must never touch a production database.",
  );
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

const SEED_SOURCE = "pexels";
const PLACEHOLDER_IMAGE = "/placeholder-product.svg";

// ---------------------------------------------------------------------------
// Catalogue definition
// ---------------------------------------------------------------------------

type Colour = { name: string; hex: string };

const C = {
  black: { name: "Black", hex: "#111111" },
  white: { name: "Off White", hex: "#F2F0EB" },
  navy: { name: "Navy", hex: "#1B2A4A" },
  charcoal: { name: "Charcoal", hex: "#3A3A3C" },
  olive: { name: "Olive", hex: "#4A5D3A" },
  sand: { name: "Sand", hex: "#D8C3A5" },
  stone: { name: "Stone", hex: "#A8A29E" },
  burgundy: { name: "Burgundy", hex: "#5C1A2B" },
  sage: { name: "Sage", hex: "#9CAF88" },
  rust: { name: "Rust", hex: "#A8471F" },
  indigo: { name: "Indigo", hex: "#2C3E63" },
  cream: { name: "Cream", hex: "#EFE7DA" },
  blush: { name: "Blush", hex: "#E5C1BD" },
  forest: { name: "Forest", hex: "#22432F" },
  camel: { name: "Camel", hex: "#B08A5A" },
  slate: { name: "Slate", hex: "#55606E" },
} satisfies Record<string, Colour>;

const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
const WAIST_SIZES = ["28", "30", "32", "34", "36", "38"] as const;

type CategorySeed = {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
};

const CATEGORIES: CategorySeed[] = [
  {
    slug: "men",
    name: "Men",
    children: [
      { slug: "men-t-shirts", name: "T-Shirts" },
      { slug: "men-shirts", name: "Shirts" },
      { slug: "men-knitwear", name: "Knitwear" },
      { slug: "men-outerwear", name: "Outerwear" },
      { slug: "men-jeans", name: "Jeans" },
      { slug: "men-trousers", name: "Trousers" },
    ],
  },
  {
    slug: "women",
    name: "Women",
    children: [
      { slug: "women-dresses", name: "Dresses" },
      { slug: "women-tops", name: "Tops" },
      { slug: "women-knitwear", name: "Knitwear" },
      { slug: "women-outerwear", name: "Outerwear" },
      { slug: "women-jeans", name: "Jeans" },
      { slug: "women-skirts", name: "Skirts" },
    ],
  },
];

type ProductSeed = {
  title: string;
  category: string;
  gender: "MEN" | "WOMEN" | "UNISEX";
  brand: string;
  /** Base price in the store's base currency (PKR). */
  price: number;
  colours: Colour[];
  sizes: readonly string[];
  /** Search term used against the Pexels API when a key is configured. */
  imageQuery: string;
  featured?: boolean;
};

const A = APPAREL_SIZES;
const W = WAIST_SIZES;

const PRODUCTS: ProductSeed[] = [
  // --- Men · T-shirts -------------------------------------------------------
  {
    title: "Heavyweight Cotton Tee",
    category: "men-t-shirts",
    gender: "MEN",
    brand: "Atlas Basics",
    price: 2490,
    colours: [C.black, C.white, C.navy],
    sizes: A,
    imageQuery: "mens plain t-shirt",
    featured: true,
  },
  {
    title: "Garment-Dyed Pocket Tee",
    category: "men-t-shirts",
    gender: "MEN",
    brand: "Atlas Basics",
    price: 2990,
    colours: [C.olive, C.sand, C.charcoal],
    sizes: A,
    imageQuery: "mens pocket tshirt",
  },
  {
    title: "Long Sleeve Waffle Tee",
    category: "men-t-shirts",
    gender: "MEN",
    brand: "Atlas Basics",
    price: 3490,
    colours: [C.cream, C.slate],
    sizes: A,
    imageQuery: "mens long sleeve shirt",
  },
  {
    title: "Boxy Graphic Tee",
    category: "men-t-shirts",
    gender: "MEN",
    brand: "Meridian",
    price: 3190,
    colours: [C.white, C.black],
    sizes: A,
    imageQuery: "mens graphic tshirt",
  },
  {
    title: "Ribbed Tank",
    category: "men-t-shirts",
    gender: "MEN",
    brand: "Atlas Basics",
    price: 1990,
    colours: [C.white, C.charcoal],
    sizes: A,
    imageQuery: "mens tank top",
  },

  // --- Men · Shirts ---------------------------------------------------------
  {
    title: "Oxford Button-Down Shirt",
    category: "men-shirts",
    gender: "MEN",
    brand: "Meridian",
    price: 5990,
    colours: [C.white, C.indigo, C.stone],
    sizes: A,
    imageQuery: "mens oxford shirt",
    featured: true,
  },
  {
    title: "Linen Camp Collar Shirt",
    category: "men-shirts",
    gender: "MEN",
    brand: "Meridian",
    price: 6490,
    colours: [C.sand, C.sage],
    sizes: A,
    imageQuery: "mens linen shirt",
  },
  {
    title: "Brushed Flannel Overshirt",
    category: "men-shirts",
    gender: "MEN",
    brand: "Northbound",
    price: 7490,
    colours: [C.burgundy, C.forest, C.charcoal],
    sizes: A,
    imageQuery: "mens flannel shirt",
  },
  {
    title: "Poplin Long Sleeve Shirt",
    category: "men-shirts",
    gender: "MEN",
    brand: "Meridian",
    price: 5490,
    colours: [C.white, C.navy],
    sizes: A,
    imageQuery: "mens dress shirt",
  },
  {
    title: "Corduroy Shirt Jacket",
    category: "men-shirts",
    gender: "MEN",
    brand: "Northbound",
    price: 8990,
    colours: [C.camel, C.olive],
    sizes: A,
    imageQuery: "mens corduroy shirt",
  },

  // --- Men · Knitwear -------------------------------------------------------
  {
    title: "Merino Crew Neck Jumper",
    category: "men-knitwear",
    gender: "MEN",
    brand: "Atlas Knit",
    price: 9490,
    colours: [C.navy, C.charcoal, C.cream],
    sizes: A,
    imageQuery: "mens wool sweater",
    featured: true,
  },
  {
    title: "Cable Knit Cardigan",
    category: "men-knitwear",
    gender: "MEN",
    brand: "Atlas Knit",
    price: 10990,
    colours: [C.cream, C.forest],
    sizes: A,
    imageQuery: "mens cardigan",
  },
  {
    title: "Half-Zip Lambswool Sweater",
    category: "men-knitwear",
    gender: "MEN",
    brand: "Atlas Knit",
    price: 9990,
    colours: [C.slate, C.rust],
    sizes: A,
    imageQuery: "mens half zip sweater",
  },
  {
    title: "Cotton Hoodie",
    category: "men-knitwear",
    gender: "MEN",
    brand: "Atlas Basics",
    price: 6990,
    colours: [C.charcoal, C.black, C.sand],
    sizes: A,
    imageQuery: "mens hoodie",
  },
  {
    title: "Fleece Crew Sweatshirt",
    category: "men-knitwear",
    gender: "MEN",
    brand: "Atlas Basics",
    price: 5990,
    colours: [C.stone, C.navy],
    sizes: A,
    imageQuery: "mens sweatshirt",
  },

  // --- Men · Outerwear ------------------------------------------------------
  {
    title: "Waxed Cotton Field Jacket",
    category: "men-outerwear",
    gender: "MEN",
    brand: "Northbound",
    price: 18990,
    colours: [C.olive, C.black],
    sizes: A,
    imageQuery: "mens field jacket",
    featured: true,
  },
  {
    title: "Quilted Liner Jacket",
    category: "men-outerwear",
    gender: "MEN",
    brand: "Northbound",
    price: 14990,
    colours: [C.forest, C.charcoal],
    sizes: A,
    imageQuery: "mens quilted jacket",
  },
  {
    title: "Wool Overcoat",
    category: "men-outerwear",
    gender: "MEN",
    brand: "Meridian",
    price: 24990,
    colours: [C.camel, C.charcoal],
    sizes: A,
    imageQuery: "mens wool coat",
  },
  {
    title: "Lightweight Bomber",
    category: "men-outerwear",
    gender: "MEN",
    brand: "Meridian",
    price: 12990,
    colours: [C.black, C.navy],
    sizes: A,
    imageQuery: "mens bomber jacket",
  },
  {
    title: "Packable Rain Shell",
    category: "men-outerwear",
    gender: "MEN",
    brand: "Northbound",
    price: 11490,
    colours: [C.slate, C.rust],
    sizes: A,
    imageQuery: "mens rain jacket",
  },

  // --- Men · Jeans ----------------------------------------------------------
  {
    title: "Straight Leg Selvedge Jeans",
    category: "men-jeans",
    gender: "MEN",
    brand: "Loom & Co.",
    price: 8990,
    colours: [C.indigo, C.black],
    sizes: W,
    imageQuery: "mens straight jeans",
    featured: true,
  },
  {
    title: "Slim Tapered Jeans",
    category: "men-jeans",
    gender: "MEN",
    brand: "Loom & Co.",
    price: 7990,
    colours: [C.indigo, C.slate],
    sizes: W,
    imageQuery: "mens slim jeans",
  },
  {
    title: "Relaxed Fit Jeans",
    category: "men-jeans",
    gender: "MEN",
    brand: "Loom & Co.",
    price: 7490,
    colours: [C.stone, C.indigo],
    sizes: W,
    imageQuery: "mens relaxed jeans",
  },
  {
    title: "Washed Black Denim",
    category: "men-jeans",
    gender: "MEN",
    brand: "Loom & Co.",
    price: 8490,
    colours: [C.black],
    sizes: W,
    imageQuery: "mens black jeans",
  },

  // --- Men · Trousers -------------------------------------------------------
  {
    title: "Pleated Wool Trousers",
    category: "men-trousers",
    gender: "MEN",
    brand: "Meridian",
    price: 9990,
    colours: [C.charcoal, C.camel],
    sizes: W,
    imageQuery: "mens wool trousers",
  },
  {
    title: "Cotton Chino",
    category: "men-trousers",
    gender: "MEN",
    brand: "Atlas Basics",
    price: 6490,
    colours: [C.sand, C.olive, C.navy],
    sizes: W,
    imageQuery: "mens chinos",
  },
  {
    title: "Drawstring Linen Trouser",
    category: "men-trousers",
    gender: "MEN",
    brand: "Meridian",
    price: 7490,
    colours: [C.cream, C.stone],
    sizes: W,
    imageQuery: "mens linen trousers",
  },
  {
    title: "Cargo Utility Pant",
    category: "men-trousers",
    gender: "MEN",
    brand: "Northbound",
    price: 8490,
    colours: [C.olive, C.black],
    sizes: W,
    imageQuery: "mens cargo pants",
  },

  // --- Women · Dresses ------------------------------------------------------
  {
    title: "Bias Cut Slip Dress",
    category: "women-dresses",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 11990,
    colours: [C.black, C.blush, C.forest],
    sizes: A,
    imageQuery: "womens slip dress",
    featured: true,
  },
  {
    title: "Poplin Shirt Dress",
    category: "women-dresses",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 10490,
    colours: [C.white, C.indigo],
    sizes: A,
    imageQuery: "womens shirt dress",
  },
  {
    title: "Knitted Midi Dress",
    category: "women-dresses",
    gender: "WOMEN",
    brand: "Atlas Knit",
    price: 12990,
    colours: [C.cream, C.rust],
    sizes: A,
    imageQuery: "womens knit dress",
  },
  {
    title: "Pleated Maxi Dress",
    category: "women-dresses",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 13990,
    colours: [C.sage, C.black],
    sizes: A,
    imageQuery: "womens maxi dress",
  },
  {
    title: "Linen Wrap Dress",
    category: "women-dresses",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 11490,
    colours: [C.sand, C.white],
    sizes: A,
    imageQuery: "womens linen dress",
  },

  // --- Women · Tops ---------------------------------------------------------
  {
    title: "Silk Camisole",
    category: "women-tops",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 6990,
    colours: [C.blush, C.black, C.cream],
    sizes: A,
    imageQuery: "womens silk camisole",
  },
  {
    title: "Boxy Cotton Tee",
    category: "women-tops",
    gender: "WOMEN",
    brand: "Atlas Basics",
    price: 2790,
    colours: [C.white, C.black, C.sage],
    sizes: A,
    imageQuery: "womens tshirt",
  },
  {
    title: "Poplin Blouse",
    category: "women-tops",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 7490,
    colours: [C.white, C.indigo],
    sizes: A,
    imageQuery: "womens blouse",
    featured: true,
  },
  {
    title: "Ribbed Long Sleeve Top",
    category: "women-tops",
    gender: "WOMEN",
    brand: "Atlas Basics",
    price: 3990,
    colours: [C.charcoal, C.cream],
    sizes: A,
    imageQuery: "womens long sleeve top",
  },
  {
    title: "Cropped Knit Vest",
    category: "women-tops",
    gender: "WOMEN",
    brand: "Atlas Knit",
    price: 5490,
    colours: [C.camel, C.forest],
    sizes: A,
    imageQuery: "womens knit vest",
  },

  // --- Women · Knitwear -----------------------------------------------------
  {
    title: "Oversized Merino Jumper",
    category: "women-knitwear",
    gender: "WOMEN",
    brand: "Atlas Knit",
    price: 10990,
    colours: [C.cream, C.slate, C.burgundy],
    sizes: A,
    imageQuery: "womens wool sweater",
    featured: true,
  },
  {
    title: "Alpaca Blend Cardigan",
    category: "women-knitwear",
    gender: "WOMEN",
    brand: "Atlas Knit",
    price: 13490,
    colours: [C.sand, C.charcoal],
    sizes: A,
    imageQuery: "womens cardigan",
  },
  {
    title: "Fine Gauge Turtleneck",
    category: "women-knitwear",
    gender: "WOMEN",
    brand: "Atlas Knit",
    price: 8490,
    colours: [C.black, C.cream],
    sizes: A,
    imageQuery: "womens turtleneck",
  },
  {
    title: "Relaxed Zip Hoodie",
    category: "women-knitwear",
    gender: "WOMEN",
    brand: "Atlas Basics",
    price: 6990,
    colours: [C.stone, C.navy],
    sizes: A,
    imageQuery: "womens hoodie",
  },

  // --- Women · Outerwear ----------------------------------------------------
  {
    title: "Belted Trench Coat",
    category: "women-outerwear",
    gender: "WOMEN",
    brand: "Meridian",
    price: 22990,
    colours: [C.camel, C.black],
    sizes: A,
    imageQuery: "womens trench coat",
    featured: true,
  },
  {
    title: "Cropped Denim Jacket",
    category: "women-outerwear",
    gender: "WOMEN",
    brand: "Loom & Co.",
    price: 9990,
    colours: [C.indigo, C.white],
    sizes: A,
    imageQuery: "womens denim jacket",
  },
  {
    title: "Wool Blend Blazer",
    category: "women-outerwear",
    gender: "WOMEN",
    brand: "Meridian",
    price: 16990,
    colours: [C.charcoal, C.cream],
    sizes: A,
    imageQuery: "womens blazer",
  },
  {
    title: "Quilted Puffer Jacket",
    category: "women-outerwear",
    gender: "WOMEN",
    brand: "Northbound",
    price: 15490,
    colours: [C.black, C.sage],
    sizes: A,
    imageQuery: "womens puffer jacket",
  },

  // --- Women · Jeans --------------------------------------------------------
  {
    title: "High Rise Straight Jeans",
    category: "women-jeans",
    gender: "WOMEN",
    brand: "Loom & Co.",
    price: 8490,
    colours: [C.indigo, C.stone],
    sizes: W,
    imageQuery: "womens straight jeans",
    featured: true,
  },
  {
    title: "Wide Leg Jeans",
    category: "women-jeans",
    gender: "WOMEN",
    brand: "Loom & Co.",
    price: 8990,
    colours: [C.indigo, C.black],
    sizes: W,
    imageQuery: "womens wide leg jeans",
  },
  {
    title: "Cropped Slim Jeans",
    category: "women-jeans",
    gender: "WOMEN",
    brand: "Loom & Co.",
    price: 7990,
    colours: [C.slate, C.white],
    sizes: W,
    imageQuery: "womens cropped jeans",
  },
  {
    title: "Barrel Leg Denim",
    category: "women-jeans",
    gender: "WOMEN",
    brand: "Loom & Co.",
    price: 9490,
    colours: [C.indigo],
    sizes: W,
    imageQuery: "womens barrel jeans",
  },

  // --- Women · Skirts -------------------------------------------------------
  {
    title: "Pleated Midi Skirt",
    category: "women-skirts",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 7990,
    colours: [C.forest, C.black],
    sizes: A,
    imageQuery: "womens pleated skirt",
  },
  {
    title: "Denim Column Skirt",
    category: "women-skirts",
    gender: "WOMEN",
    brand: "Loom & Co.",
    price: 6990,
    colours: [C.indigo, C.stone],
    sizes: A,
    imageQuery: "womens denim skirt",
  },
  {
    title: "Satin Bias Skirt",
    category: "women-skirts",
    gender: "WOMEN",
    brand: "Marlowe",
    price: 8490,
    colours: [C.blush, C.charcoal],
    sizes: A,
    imageQuery: "womens satin skirt",
  },
];

// ---------------------------------------------------------------------------
// Shipping zones (F3 resolves a destination country against these)
// ---------------------------------------------------------------------------

const SHIPPING_ZONES = [
  {
    name: "Pakistan",
    countries: ["PK"],
    position: 0,
    rates: [
      { name: "Standard (3-5 days)", price: 350, freeOver: 8000, minDays: 3, maxDays: 5 },
      { name: "Express (1-2 days)", price: 900, freeOver: null, minDays: 1, maxDays: 2 },
    ],
  },
  {
    name: "South Asia",
    countries: ["IN", "BD", "LK", "NP", "BT", "MV", "AF"],
    position: 1,
    rates: [
      {
        name: "Standard (5-9 days)",
        price: 2200,
        freeOver: 30000,
        minDays: 5,
        maxDays: 9,
      },
    ],
  },
  {
    name: "Middle East",
    countries: ["AE", "SA", "QA", "KW", "BH", "OM", "JO", "TR"],
    position: 2,
    rates: [
      {
        name: "Standard (5-8 days)",
        price: 2800,
        freeOver: 35000,
        minDays: 5,
        maxDays: 8,
      },
      { name: "Express (3-4 days)", price: 5200, freeOver: null, minDays: 3, maxDays: 4 },
    ],
  },
  {
    name: "Europe",
    countries: [
      "GB",
      "IE",
      "FR",
      "DE",
      "IT",
      "ES",
      "NL",
      "BE",
      "SE",
      "NO",
      "DK",
      "PL",
      "PT",
      "AT",
      "CH",
    ],
    position: 3,
    rates: [
      {
        name: "Standard (7-12 days)",
        price: 3600,
        freeOver: 45000,
        minDays: 7,
        maxDays: 12,
      },
      { name: "Express (3-5 days)", price: 7200, freeOver: null, minDays: 3, maxDays: 5 },
    ],
  },
  {
    name: "North America",
    countries: ["US", "CA", "MX"],
    position: 4,
    rates: [
      {
        name: "Standard (7-14 days)",
        price: 3900,
        freeOver: 45000,
        minDays: 7,
        maxDays: 14,
      },
      { name: "Express (3-5 days)", price: 7800, freeOver: null, minDays: 3, maxDays: 5 },
    ],
  },
  {
    // Catch-all. Matched only when no explicit zone contains the country.
    name: "Rest of World",
    countries: ["*"],
    position: 99,
    rates: [
      {
        name: "International (10-20 days)",
        price: 4900,
        freeOver: 60000,
        minDays: 10,
        maxDays: 20,
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function skuCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 4);
}

/**
 * Deterministic pseudo-random stock so repeated seeds produce the same
 * catalogue. Roughly one variant in nine is out of stock, which gives F2 a
 * disabled variant to render and F3 a sold-out path to exercise.
 */
function stockFor(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const bucket = Math.abs(hash) % 9;
  return bucket === 0 ? 0 : bucket * 4;
}

type PexelsPhoto = { id: number; src: { large: string; medium: string } };

/**
 * Fetches product imagery from Pexels when a key is configured. Without a key
 * the catalogue still seeds, using a local placeholder, so a fresh clone works
 * offline.
 */
async function fetchImages(
  query: string,
  apiKey: string | undefined,
): Promise<{ images: string[]; externalId: string | null }> {
  if (!apiKey) return { images: [PLACEHOLDER_IMAGE], externalId: null };

  try {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "2");
    url.searchParams.set("orientation", "portrait");

    const response = await fetch(url, { headers: { Authorization: apiKey } });
    if (!response.ok) {
      console.warn(`  Pexels ${response.status} for "${query}"; using placeholder.`);
      return { images: [PLACEHOLDER_IMAGE], externalId: null };
    }

    const body = (await response.json()) as { photos?: PexelsPhoto[] };
    const photos = body.photos ?? [];
    if (photos.length === 0) return { images: [PLACEHOLDER_IMAGE], externalId: null };

    return {
      images: photos.map((photo) => photo.src.large),
      externalId: String(photos[0]!.id),
    };
  } catch (error) {
    console.warn(`  Pexels request failed for "${query}":`, error);
    return { images: [PLACEHOLDER_IMAGE], externalId: null };
  }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env.PEXELS_API_KEY?.trim() || undefined;
  console.log(
    apiKey
      ? "Seeding with Pexels imagery."
      : "Seeding without PEXELS_API_KEY — products use a local placeholder image.",
  );

  // Idempotent re-seed: remove previous demo data only. Variants, reviews and
  // wishlist rows cascade from Product.
  const removed = await prisma.product.deleteMany({ where: { source: SEED_SOURCE } });
  if (removed.count > 0)
    console.log(`Removed ${removed.count} previously seeded products.`);
  await prisma.shippingZone.deleteMany({});
  await prisma.category.deleteMany({});

  // Categories (two levels).
  const categoryIds = new Map<string, string>();
  for (const [index, parent] of CATEGORIES.entries()) {
    const created = await prisma.category.create({
      data: {
        slug: parent.slug,
        name: parent.name,
        position: index,
        description: `${parent.name}'s clothing.`,
      },
    });
    categoryIds.set(parent.slug, created.id);

    for (const [childIndex, child] of parent.children.entries()) {
      const createdChild = await prisma.category.create({
        data: {
          slug: child.slug,
          name: child.name,
          position: childIndex,
          parentId: created.id,
        },
      });
      categoryIds.set(child.slug, createdChild.id);
    }
  }
  console.log(`Created ${categoryIds.size} categories.`);

  // Products and their size x colour variants.
  let variantCount = 0;
  const seenSkus = new Set<string>();

  for (const [productIndex, product] of PRODUCTS.entries()) {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`Unknown category: ${product.category}`);

    const slug = slugify(product.title);
    const { images, externalId } = await fetchImages(product.imageQuery, apiKey);

    const variants = product.colours.flatMap((colour, colourIndex) =>
      product.sizes.map((size, sizeIndex) => ({
        size,
        colorName: colour.name,
        colorHex: colour.hex,
        // The brand and title codes are for humans; the numeric block is what
        // guarantees uniqueness. Two products can share a four-letter title
        // code ("Poplin Blouse" and "Poplin Shirt Dress"), so a readable code
        // alone is not a key.
        sku: `${skuCode(product.brand)}-${skuCode(product.title)}-${String(productIndex + 1).padStart(3, "0")}${colourIndex}-${size}`,
        stock: stockFor(`${slug}:${colour.name}:${size}`),
        position: colourIndex * 10 + sizeIndex,
      })),
    );

    for (const variant of variants) {
      if (seenSkus.has(variant.sku)) {
        throw new Error(
          `Duplicate SKU ${variant.sku} for "${product.title}". SKUs must be unique.`,
        );
      }
      seenSkus.add(variant.sku);
    }

    await prisma.product.create({
      data: {
        slug,
        title: product.title,
        description:
          `${product.title} by ${product.brand}. Cut for everyday wear and built to ` +
          `survive the wash. Available in ${product.colours.length} colour` +
          `${product.colours.length === 1 ? "" : "s"} across ${product.sizes.length} sizes.`,
        brand: product.brand,
        gender: product.gender,
        basePrice: product.price.toFixed(2),
        images,
        attributes: {
          material: "Cotton blend",
          care: "Machine wash cold, line dry",
          fit: "Regular",
        },
        isFeatured: product.featured ?? false,
        categoryId,
        source: SEED_SOURCE,
        externalId: externalId ?? slug,
        variants: { create: variants },
      },
    });

    variantCount += variants.length;
  }
  console.log(`Created ${PRODUCTS.length} products with ${variantCount} variants.`);

  // Shipping zones and rates.
  for (const zone of SHIPPING_ZONES) {
    await prisma.shippingZone.create({
      data: {
        name: zone.name,
        countries: [...zone.countries],
        position: zone.position,
        rates: {
          create: zone.rates.map((rate) => ({
            name: rate.name,
            price: rate.price.toFixed(2),
            freeOver: rate.freeOver === null ? null : rate.freeOver.toFixed(2),
            minDays: rate.minDays,
            maxDays: rate.maxDays,
          })),
        },
      },
    });
  }
  console.log(`Created ${SHIPPING_ZONES.length} shipping zones.`);

  const outOfStock = await prisma.productVariant.count({ where: { stock: 0 } });
  console.log(`Done. ${outOfStock} variants seeded out of stock (intentional).`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
