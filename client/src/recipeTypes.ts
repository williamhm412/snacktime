export interface Measure {
  qty: number;
  unit: string;
  note?: string | null;
}

export interface Ingredient {
  name: string;
  trackedFoodId: string | null;
  optional: boolean;
  measures: { weight: Measure | null; volume: Measure | null };
}

export interface RecipeIdea {
  scope: "combined" | "single";
  usesFoodIds: string[];
  title: string;
  whyThisOne: string;
  servings: number;
  times: { prepMinutes: number; cookMinutes: number };
  ingredients: Ingredient[];
  instructions: string[];
  comments: string;
}

export interface IdeasDoc {
  generatedAt: string;
  generator: string;
  foodSnapshot: string[];
  ideas: RecipeIdea[];
}

export interface IdeasView {
  status: "ok" | "generating" | "empty";
  generating: boolean;
  cache: IdeasDoc | null;
  error: string | null;
}
