import { useEffect, useMemo, useRef, useState } from "react";
import "@radix-ui/themes/styles.css";
import { Excalidraw } from "@excalidraw/excalidraw";
import { Slider } from "@radix-ui/themes";
import { LoroDoc, LoroList, LoroMap, OpId, VersionVector } from "loro-crdt";
import deepEqual from "deep-equal";
import "./App.css";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import pako from "pako";

function opIdToString(id: OpId): string {
  return `${id.counter}@${id.peer.toString()}`;
}

function frontierToString(frontier: OpId[]): string {
  return frontier.map(opIdToString).join(",");
}

function frontiersToString(frontiers: OpId[][]): string {
  return frontiers.map(frontierToString).join(";");
}

function stringToOpId(str: string): OpId {
  const [counter, peer] = str.split("@");
  return {
    counter: parseInt(counter),
    peer: peer as `${number}`,
  };
}

function stringToFrontier(str: string): OpId[] {
  return str.split(",").map(stringToOpId);
}

function stringToFrontiers(str: string): OpId[][] {
  if (str === "") {
    return [];
  }

  return str.split(";").map(stringToFrontier);
}

function App() {
  const excalidrawAPI = useRef<ExcalidrawImperativeAPI>();
  const versionsRef = useRef<OpId[][]>([]);
  const [docSize, setDocSize] = useState({
    updates: 0,
    shallowSnapshot: 0,
    snapshot: 0,
  });
  const [compressedDocSize, setCompressedDocSize] = useState({
    updates: 0,
    shallowSnapshot: 0,
    snapshot: 0,
  });
  const [maxVersion, setMaxVersion] = useState(-1);
  const [vv, setVV] = useState("");
  const channel = useMemo(() => {
    return new BroadcastChannel("temp");
  }, []);
  useEffect(() => {
    return () => {
      channel.close();
    };
  }, [channel]);
  const [versionNum, setVersionNum] = useState(-1);

  const { doc, docElements } = useMemo(() => {
    const doc = new LoroDoc();
    const data = localStorage.getItem("store");
    setTimeout(() => {
      const versions = localStorage.getItem("frontiers");
      versionsRef.current = stringToFrontiers(versions || "");
      setMaxVersion(versionsRef.current.length - 1);
      setVersionNum(versionsRef.current.length - 1);
    });

    const docElements = doc.getList("elements");
    let lastVersion: VersionVector | undefined = undefined;
    channel.onmessage = (e) => {
      const bytes = new Uint8Array(e.data);
      try {
        doc.import(bytes);
      } catch (e) {
        localStorage.clear();
        location.reload();
      }
    };
    doc.subscribe((e) => {
      const version = Object.fromEntries(doc.version().toJSON());
      let vv = "";
      for (const [k, v] of Object.entries(version)) {
        vv += `${k.toString().slice(0, 4)}:${v} `;
      }

      setVV(vv);
      if (e.by === "local") {
        const bytes = doc.export({ mode: "update", from: lastVersion });
        lastVersion = doc.version();
        channel.postMessage(bytes);
      }
      if (e.by !== "checkout") {
        versionsRef.current.push(doc.frontiers());
        setMaxVersion(versionsRef.current.length - 1);
        setVersionNum(versionsRef.current.length - 1);
        const updates = doc.export({ mode: "update" });
        let str = "";
        for (let i = 0; i < updates.length; i++) {
          str += String.fromCharCode(updates[i]);
        }
        localStorage.setItem("store", btoa(str));
        localStorage.setItem(
          "frontiers",
          frontiersToString(versionsRef.current),
        );
        const snapshot = doc.export({
          mode: "snapshot",
        });
        const shallowSnapshot = doc.export({
          mode: "shallow-snapshot",
          frontiers: doc.frontiers(),
        });
        setDocSize({
          updates: updates.length,
          snapshot: snapshot.length,
          shallowSnapshot: shallowSnapshot.length,
        });
        setCompressedDocSize({
          updates: getCompressedSize(updates),
          snapshot: getCompressedSize(snapshot),
          shallowSnapshot: getCompressedSize(shallowSnapshot),
        });
      }
      if (e.by !== "local") {
        excalidrawAPI.current?.updateScene({ elements: docElements.toJSON() });
      }
    });
    setTimeout(() => {
      if (data && data?.length > 0) {
        const bytes = new Uint8Array(
          atob(data).split("").map(function (c) {
            return c.charCodeAt(0);
          }),
        );
        doc.checkoutToLatest();
        doc.import(bytes);
        setMaxVersion(versionsRef.current.length - 1);
        setVersionNum(versionsRef.current.length - 1);
      }
    }, 100);
    return { doc, docElements };
  }, [channel]);

  const lastVersion = useRef(-1);
  return (
    <div>
      <div style={{ width: "100%", height: "calc(100vh - 100px)" }}>
        <Excalidraw
          excalidrawAPI={(api) => {
            excalidrawAPI.current = api;
          }}
          viewModeEnabled={versionNum !== maxVersion}
          onChange={(elements) => {
            const v = getVersion(elements);
            if (lastVersion.current === v) {
              // local change, should detect and record the diff to loro doc
              if (recordLocalOps(docElements, elements)) {
                doc.commit();
              }
              // if (!deepEqual(docElements.getDeepValue(), elements)) {
              //   console.log(docElements.getDeepValue(), elements);
              // }
            }

            lastVersion.current = v;
          }}
        />
      </div>
      <div style={{ margin: "1em 2em", zIndex: 7 }}>
        <div
          style={{
            fontSize: "0.8em",
            width: "100%",
            display: "flex",
            flexDirection: "row",
            position: "relative",
            justifyContent: "flex-start",
          }}
        >
          <div>
            <button
              onClick={() => {
                localStorage.clear();
                location.reload();
              }}
            >
              Clear
            </button>{" "}
            Version Vector {vv}
          </div>
          <div
            style={{
              position: "absolute",
              right: 16,
              bottom: 0,
              zIndex: 7,
              textAlign: "right",
            }}
          >
            <p>
              Updates size {docSize.updates} bytes; Compressed size{" "}
              {compressedDocSize.updates} bytes
            </p>
            <p>
              Snapshot size {docSize.snapshot} bytes; Compressed size{" "}
              {compressedDocSize.snapshot} bytes
            </p>
            <p>
              Shallow snapshot size {docSize.shallowSnapshot}{" "}
              bytes; Compressed size {compressedDocSize.shallowSnapshot} bytes
            </p>
          </div>
        </div>
        <Slider
          value={[versionNum]}
          min={-1}
          max={maxVersion}
          onValueChange={(v) => {
            setVersionNum(v[0]);
            if (v[0] === -1) {
              doc.checkout([]);
            } else {
              if (v[0] === versionsRef.current.length - 1) {
                doc.checkoutToLatest();
              } else {
                doc.checkout(versionsRef.current[v[0]]);
              }
            }
          }}
        />
      </div>
    </div>
  );
}

function getCompressedSize(data: Uint8Array): number {
  try {
    return pako.deflateRaw(data).length;
  } catch (e) {
    return 0;
  }
}

function recordLocalOps(
  loroList: LoroList,
  elements: readonly { version: number; isDeleted?: boolean }[],
): boolean {
  elements = elements.filter((e) => !e.isDeleted);
  let changed = false;
  for (let i = loroList.length; i < elements.length; i++) {
    loroList.insertContainer(i, new LoroMap());
    changed = true;
  }
  if (elements.length < loroList.length) {
    loroList.delete(elements.length, loroList.length - elements.length);
    changed = true;
  }

  const n = elements.length;
  for (let i = 0; i < n; i++) {
    const map = loroList.get(i) as LoroMap | undefined;
    if (!map) {
      break;
    }

    const elem = elements[i];
    if (map.get("version") === elem.version) {
      continue;
    }

    for (const [key, value] of Object.entries(elem)) {
      const src = map.get(key);
      if (
        (typeof src === "object" && !deepEqual(map.get(key), value)) ||
        src !== value
      ) {
        changed = true;
        map.set(key, value);
      }
    }
  }

  return changed;
}

function getVersion(elems: readonly { version: number }[]): number {
  return elems.reduce((acc, curr) => {
    return curr.version + acc;
  }, 0);
}

export default App;
