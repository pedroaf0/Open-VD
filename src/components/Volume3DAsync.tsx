import { lazy, Suspense, type ComponentProps } from "react";
import { LoadingIcons } from "@/components/LoadingIcons";

/**
 * Lazy boundary around the Three.js viewport.
 *
 * `Volume3D` (and Three.js) is by far the heaviest part of the viewer. Loading
 * it only when a 3D viewport is actually rendered keeps the initial bundle
 * small; the chunk is requested after the volume/meshes are ready.
 */
type Volume3DModule = typeof import("@/components/Volume3D");
type Volume3DProps = ComponentProps<Volume3DModule["Volume3D"]>;

const Volume3D = lazy(async () => {
  const mod = await import("@/components/Volume3D");
  return { default: mod.Volume3D };
});

export function Volume3DAsync(props: Volume3DProps) {
  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center" aria-busy="true">
          <LoadingIcons size={40} />
        </div>
      }
    >
      <Volume3D {...props} />
    </Suspense>
  );
}
