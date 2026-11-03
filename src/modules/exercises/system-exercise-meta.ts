import type pg from "pg";

/**
 * Dodatkowe dane ćwiczeń systemowych: sprzęt, rodzaj ruchu, inne nazwy
 * (do szukania) i opis techniki. Klucze to id z migracji 003/027/028.
 *
 * `syncSystemExerciseMeta` zapisuje je do bazy przy każdym starcie API, tak jak
 * obrazki w `system-exercise-images.ts` — poprawka opisu nie wymaga migracji.
 * Własnych ćwiczeń użytkowników nie dotykamy.
 */
export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable",
  "machine",
  "bodyweight",
  "band",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** Rodzaje ruchu: ćwiczenia z tym samym mięśniem głównym i ruchem są „podobne”. */
export const MOVEMENT_PATTERNS = [
  "push_horizontal",
  "push_incline",
  "push_vertical",
  "pull_vertical",
  "pull_horizontal",
  "squat",
  "hinge",
  "lunge",
  "curl",
  "triceps_extension",
  "fly",
  "raise",
  "shrug",
  "leg_curl",
  "leg_extension",
  "calf_raise",
  "glute_bridge",
  "hip_abduction",
  "hip_adduction",
  "dip",
  "pullover",
  "skill",
  "core_flexion",
  "core_stability",
  "core_rotation",
  "carry",
  "plyometric",
  "cardio",
  "mobility",
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export interface Instructions {
  steps: string[];
  mistakes: string[];
}

export interface SystemExerciseMeta {
  equipment: Equipment;
  pattern: MovementPattern;
  aliases: string[];
  instructions: Instructions;
}

const m = (
  equipment: Equipment,
  pattern: MovementPattern,
  aliases: string[],
  steps: string[],
  mistakes: string[],
): SystemExerciseMeta => ({
  equipment,
  pattern,
  aliases,
  instructions: { steps, mistakes },
});

const id = (n: number) => `a1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

export const SYSTEM_EXERCISE_META: Readonly<Record<string, SystemExerciseMeta>> = {
  [id(1)]: m("barbell", "push_horizontal", ["bench", "bench press", "wyciskanie leżąc", "klata sztanga"], [
    "Połóż się tak, żeby oczy były pod sztangą. Stopy płasko na podłodze, łopatki ściągnięte i opuszczone.",
    "Chwyć sztangę nieco szerzej niż barki i zdejmij ją ze stojaków.",
    "Opuść ją powoli, pod kontrolą, do dolnej części klatki, łokcie pod kątem około 45° do tułowia.",
    "Wypchnij sztangę w górę do wyprostu rąk, nie odrywając pośladków od ławki.",
  ], ["Odbijanie sztangi od klatki", "Łokcie rozstawione na 90°", "Odrywanie pośladków od ławki"]),
  [id(2)]: m("bodyweight", "pull_vertical", ["podciąganie", "pull up", "pullup", "drążek"], [
    "Chwyć drążek nachwytem, nieco szerzej niż barki, i zwiśnij z wyprostowanymi rękami.",
    "Ściągnij łopatki w dół i podciągnij się, prowadząc łokcie w dół i do kieszeni.",
    "Zatrzymaj się z brodą nad drążkiem, potem opuść się powoli do pełnego wyprostu.",
  ], ["Bujanie nogami i tułowiem", "Niepełny zakres w dole", "Wyciąganie brody do drążka zamiast ciągnięcia łokciami"]),
  [id(3)]: m("barbell", "squat", ["przysiad", "squat", "back squat", "przysiad tylny"], [
    "Połóż sztangę na górnej części pleców, stopy na szerokość barków lub nieco szerzej, palce lekko na zewnątrz.",
    "Weź wdech, napnij brzuch i zejdź w dół, prowadząc kolana nad palcami.",
    "Zejdź co najmniej do równoległości ud do podłogi, plecy proste.",
    "Wstań, dociskając stopy do podłogi i trzymając tułów w tej samej linii.",
  ], ["Kolana zapadają się do środka", "Pięty odrywają się od podłogi", "Zaokrąglone plecy na dole"]),
  [id(4)]: m("dumbbell", "push_vertical", ["OHP hantle", "wyciskanie nad głowę", "shoulder press", "barki hantle"], [
    "Usiądź z oparciem lub stań, hantle na wysokości barków, przedramiona pionowo.",
    "Wypchnij hantle nad głowę do prawie pełnego wyprostu.",
    "Opuść je powoli, pod kontrolą, do wysokości uszu.",
  ], ["Mocne wyginanie odcinka lędźwiowego", "Hantle ciągnięte do przodu zamiast nad głowę", "Bujanie nogami"]),
  [id(5)]: m("barbell", "hinge", ["deadlift", "martwy", "MC"], [
    "Stań ze stopami pod sztangą na szerokość bioder, chwyć ją tuż na zewnątrz goleni.",
    "Napnij brzuch i plecy, klatka do przodu, biodra niżej niż barki.",
    "Wstań, dociskając stopy do podłogi i prowadząc sztangę blisko nóg.",
    "Opuść sztangę tą samą drogą, odsuwając biodra do tyłu.",
  ], ["Zaokrąglone plecy", "Sztanga daleko od nóg", "Szarpnięcie z podłogi zamiast płynnego naciągu"]),
  [id(6)]: m("dumbbell", "curl", ["curl", "uginanie hantle", "biceps hantle", "bicepsy"], [
    "Stań prosto, hantle w dłoniach wzdłuż ciała, łokcie przy tułowiu.",
    "Ugnij ramiona, unosząc hantle do barków i obracając dłonie do góry.",
    "Opuść powoli do pełnego wyprostu.",
  ], ["Bujanie tułowiem", "Łokcie uciekają do przodu", "Zbyt szybkie opuszczanie"]),
  [id(7)]: m("bodyweight", "dip", ["dipy", "dips", "poręcze", "pompki na poręczach"], [
    "Chwyć poręcze i wyprostuj ramiona, lekko pochyl tułów do przodu.",
    "Opuść się, zginając łokcie, do kąta około 90° w łokciach.",
    "Wypchnij się w górę do wyprostu.",
  ], ["Zbyt głębokie zejście z bólem barków", "Barki uniesione do uszu", "Bujanie nogami"]),
  [id(8)]: m("barbell", "pull_horizontal", ["wiosło", "bent over row", "wiosłowanie", "plecy sztanga"], [
    "Pochyl tułów do około 45°, plecy proste, kolana lekko ugięte, sztanga w wyprostowanych rękach.",
    "Przyciągnij sztangę do dolnej części brzucha, łokcie za tułów.",
    "Opuść powoli, pod kontrolą, do wyprostu rąk.",
  ], ["Zaokrąglone plecy", "Szarpanie tułowiem", "Sztanga ciągnięta do klatki zamiast do brzucha"]),
  [id(9)]: m("machine", "squat", ["suwnica", "leg press", "wypychanie", "prasa"], [
    "Usiądź na suwnicy, plecy oparte, stopy na platformie na szerokość barków.",
    "Zwolnij blokady i opuść platformę, aż kolana zbliżą się do klatki, nie odrywając pleców.",
    "Wypchnij platformę w górę, nie blokując całkiem kolan.",
  ], ["Odrywanie pośladków od oparcia", "Pełna blokada kolan", "Kolana zapadające się do środka"]),
  [id(10)]: m("dumbbell", "raise", ["lateral raise", "unoszenie bokiem", "wznosy bokiem", "barki boki"], [
    "Stań prosto, hantle przy udach, łokcie lekko ugięte.",
    "Unieś ramiona na boki do wysokości barków, prowadząc łokcie i trzymając kciuki równolegle do podłogi.",
    "Opuść powoli.",
  ], ["Zbyt ciężkie hantle i bujanie", "Unoszenie barków do uszu", "Ramiona powyżej linii barków"]),
  [id(11)]: m("cable", "triceps_extension", ["pushdown", "triceps wyciąg", "prostowanie na wyciągu", "tricepsy"], [
    "Stań przy wyciągu górnym, chwyć drążek lub linę, łokcie przy tułowiu.",
    "Wyprostuj ramiona w dół, nie ruszając łokci.",
    "Wróć powoli do kąta 90° w łokciach.",
  ], ["Łokcie uciekają do przodu", "Pochylanie całego tułowia", "Szarpanie ciężarem"]),
  [id(12)]: m("bodyweight", "core_stability", ["deska", "plank", "podpór na przedramionach"], [
    "Oprzyj się na przedramionach, łokcie pod barkami, nogi wyprostowane.",
    "Napnij brzuch i pośladki, ciało w jednej linii od głowy do pięt.",
    "Utrzymaj pozycję, oddychając spokojnie.",
  ], ["Biodra opadają lub wędrują w górę", "Zadarta głowa", "Wstrzymywanie oddechu"]),
  [id(13)]: m("bodyweight", "plyometric", ["burpee", "burpeesy", "padnij powstań"], [
    "Z przysiadu połóż dłonie na podłodze i wyrzuć nogi do tyłu do pozycji podporu.",
    "Zrób pompkę (opcjonalnie), potem wróć nogami do przysiadu.",
    "Wyskocz w górę z rękami nad głową.",
  ], ["Zapadnięte biodra w podporze", "Lądowanie na sztywnych nogach", "Zbyt szybkie tempo kosztem formy"]),
  [id(14)]: m("bodyweight", "mobility", ["skłon", "rozciąganie nóg", "forward fold"], [
    "Stań prosto, stopy razem lub na szerokość bioder.",
    "Pochyl tułów od bioder, aż poczujesz rozciąganie z tyłu ud.",
    "Utrzymaj 20–40 sekund, oddychając spokojnie.",
  ], ["Pochylanie się plecami zamiast biodrami", "Sprężynowanie", "Całkowita blokada kolan"]),
  [id(15)]: m("machine", "cardio", ["bieżnia", "bieg", "treadmill", "kardio"], [
    "Wejdź na pas, ustaw tempo i zacznij od spokojnego marszu.",
    "Zwiększ prędkość do planowanej, biegnij prosto z luźnymi ramionami.",
    "Na końcu zwolnij stopniowo przez 2–3 minuty.",
  ], ["Trzymanie się poręczy przy biegu", "Zbyt długi krok", "Brak rozgrzewki i wychłodzenia"]),
  [id(16)]: m("machine", "cardio", ["rower", "rowerek", "bike", "kardio"], [
    "Ustaw siodełko tak, by noga w dolnym położeniu była prawie prosta.",
    "Pedałuj płynnie, plecy proste, ramiona luźne.",
    "Reguluj opór zamiast bujać się na siodełku.",
  ], ["Zbyt niskie siodełko", "Zgarbione plecy", "Zbyt duży opór kosztem płynności"]),
  [id(17)]: m("machine", "cardio", ["wioślarz", "ergometr", "ergometr wioślarski", "kardio"], [
    "Usiądź, stopy w pasach, chwyć uchwyt prostymi rękami.",
    "Odepchnij się nogami, potem odchyl tułów i przyciągnij uchwyt do żeber.",
    "Wróć w odwrotnej kolejności: ręce, tułów, nogi.",
  ], ["Ciągnięcie rękami przed nogami", "Zaokrąglone plecy", "Zbyt szybki powrót do przodu"]),
  [id(18)]: m("machine", "cardio", ["orbitrek", "eliptyk", "cross trainer", "kardio"], [
    "Stań na pedałach, chwyć uchwyty i zacznij płynny ruch.",
    "Trzymaj tułów prosto, ciężar na całych stopach.",
    "Zmieniaj opór i kierunek ruchu dla urozmaicenia.",
  ], ["Wsparcie ciężaru na rękach", "Garbienie się", "Zbyt krótki ruch"]),
  [id(19)]: m("other", "cardio", ["skakanka", "jump rope", "kardio"], [
    "Trzymaj uchwyty przy biodrach, łokcie blisko tułowia.",
    "Obracaj linkę nadgarstkami i skacz niskimi, sprężystymi odbiciami z palców.",
    "Utrzymaj równy rytm i oddech.",
  ], ["Skakanie zbyt wysoko", "Obracanie linki całymi ramionami", "Lądowanie na piętach"]),
  [id(20)]: m("bodyweight", "skill", ["stanie na rękach", "handstand", "stójka"], [
    "Ustaw się przy ścianie, dłonie na podłodze na szerokość barków.",
    "Wejdź nogami po ścianie do pozycji pionowej, ciało w jednej linii.",
    "Utrzymaj z wyprostowanymi rękami i napiętym brzuchem.",
  ], ["Wygięte plecy w łuk", "Zgięte łokcie", "Zbyt szeroko rozstawione dłonie"]),
  [id(21)]: m("bodyweight", "push_vertical", ["HSPU", "negatywy", "pompki w staniu na rękach"], [
    "Wejdź w stanie na rękach przy ścianie.",
    "Opuszczaj się powoli (3–5 sekund), zginając łokcie, aż głowa zbliży się do podłogi.",
    "Zejdź z ćwiczenia powoli, pod kontrolą albo wypchnij się w górę.",
  ], ["Upadek zamiast kontrolowanego opuszczania", "Łokcie rozstawione szeroko", "Opuszczanie bez napięcia brzucha"]),
  [id(22)]: m("dumbbell", "fly", ["rozpiętki skośne", "incline fly", "klata góra hantle"], [
    "Połóż się na ławce skośnej (30–45°), hantle nad klatką, łokcie lekko ugięte.",
    "Rozchyl ramiona na boki w łuku, aż poczujesz rozciąganie klatki.",
    "Zbliż hantle łukiem z powrotem nad klatkę.",
  ], ["Prostowanie i zginanie łokci jak przy wyciskaniu", "Zbyt głębokie opuszczanie", "Zbyt ciężkie hantle"]),
  [id(23)]: m("dumbbell", "triceps_extension", ["triceps nad głową", "french press hantel", "overhead extension"], [
    "Usiądź lub stań, trzymaj jeden hantel oburącz nad głową.",
    "Opuść go za głowę, zginając łokcie, łokcie w górę i blisko głowy.",
    "Wyprostuj ramiona z powrotem nad głowę.",
  ], ["Łokcie rozchodzą się na boki", "Wygięty odcinek lędźwiowy", "Zbyt ciężki hantel"]),
  [id(24)]: m("bodyweight", "skill", ["muscle-up", "muscle up"], [
    "Zwiśnij na drążku z mocnym chwytem (false grip opcjonalnie).",
    "Podciągnij się dynamicznie, aż klatka znajdzie się nad drążkiem.",
    "Przejdź nad drążek, obracając nadgarstki, i wypchnij się do podporu.",
  ], ["Za wolne podciągnięcie", "Brak przejścia nadgarstków", "Bujanie bez kontroli"]),
  [id(25)]: m("other", "pull_vertical", ["podciąganie z dociążeniem", "weighted pull up", "pull-up z pasem"], [
    "Zapnij pas z obciążeniem i chwyć drążek.",
    "Podciągnij się jak w zwykłym podciąganiu, bez bujania.",
    "Opuść do pełnego wyprostu.",
  ], ["Zbyt duże obciążenie kosztem zakresu", "Bujanie", "Uniesione barki w dole"]),
  [id(26)]: m("barbell", "pull_horizontal", ["t-bar", "tbar", "wiosłowanie t-bar"], [
    "Stań nad sztangą zaczepioną jednym końcem, pochyl tułów z prostymi plecami.",
    "Przyciągnij obciążony koniec do klatki, łokcie wzdłuż tułowia.",
    "Opuść powoli, pod kontrolą.",
  ], ["Zaokrąglone plecy", "Prostowanie tułowia przy ciągnięciu", "Szarpanie ciężarem"]),
  [id(27)]: m("machine", "pull_horizontal", ["t-bar maszyna", "wiosło z podparciem", "chest supported row"], [
    "Połóż klatkę na podpórce, chwyć uchwyty.",
    "Przyciągnij uchwyty do siebie, ściągając łopatki.",
    "Wyprostuj ramiona powoli.",
  ], ["Odrywanie klatki od podpórki", "Unoszenie barków", "Zbyt krótki ruch"]),
  [id(28)]: m("cable", "pull_horizontal", ["wiosło na wyciągu", "seated row", "przyciąganie siedząc"], [
    "Usiądź, stopy na podpórkach, uchwyt w prostych rękach.",
    "Przyciągnij uchwyt do brzucha, ściągając łopatki.",
    "Wróć powoli do wyprostu rąk, bez garbienia.",
  ], ["Bujanie tułowiem", "Ramiona unoszą się do uszu", "Zaokrąglone plecy"]),
  [id(29)]: m("cable", "pull_horizontal", ["face pull", "facepull", "tylne barki wyciąg"], [
    "Ustaw linę na wysokości twarzy, chwyć ją oburącz.",
    "Przyciągnij linę do twarzy, rozchylając łokcie na boki.",
    "Wróć powoli do wyprostu rąk.",
  ], ["Zbyt duży ciężar i bujanie", "Łokcie poniżej linii barków", "Odchylanie tułowia"]),
  [id(30)]: m("barbell", "curl", ["curl sztanga", "biceps sztanga", "uginanie sztanga"], [
    "Stań prosto, chwyć sztangę podchwytem na szerokość barków.",
    "Ugnij ramiona, unosząc sztangę do klatki, łokcie przy tułowiu.",
    "Opuść powoli do wyprostu.",
  ], ["Bujanie tułowiem", "Łokcie do przodu", "Niepełny wyprost w dole"]),
  [id(31)]: m("dumbbell", "curl", ["młotki", "hammer", "hammer curl"], [
    "Stań prosto, hantle w neutralnym chwycie (kciuki do góry).",
    "Ugnij ramiona, unosząc hantle do barków, bez obracania nadgarstków.",
    "Opuść powoli.",
  ], ["Bujanie tułowiem", "Łokcie uciekają do przodu", "Szybkie opuszczanie"]),
  [id(32)]: m("bodyweight", "skill", ["front lever", "wisa przodem"], [
    "Zwiśnij na drążku, ściągnij łopatki i napnij brzuch.",
    "Unieś ciało do poziomu, plecy na wysokości drążka, nogi razem.",
    "Utrzymaj pozycję z prostymi rękami.",
  ], ["Zgięte biodra", "Zgięte ręce", "Zbyt krótkie utrzymanie kosztem formy"]),
  [id(33)]: m("barbell", "hinge", ["RDL", "rumuński", "martwy rumuński"], [
    "Stań ze sztangą w rękach przed udami, kolana lekko ugięte.",
    "Odsuń biodra do tyłu i prowadź sztangę blisko nóg do wysokości poniżej kolan.",
    "Wróć, wypychając biodra do przodu.",
  ], ["Zaokrąglone plecy", "Ugięte kolana jak w przysiadzie", "Sztanga daleko od nóg"]),
  [id(34)]: m("machine", "leg_curl", ["uginanie nóg", "leg curl", "dwugłowe maszyna"], [
    "Połóż się na maszynie, wałek tuż nad piętami.",
    "Ugnij nogi, przyciągając wałek do pośladków.",
    "Opuść powoli.",
  ], ["Odrywanie bioder od ławki", "Szarpnięcie", "Niepełny zakres"]),
  [id(35)]: m("machine", "leg_extension", ["prostowanie nóg", "leg extension", "czworogłowe maszyna"], [
    "Usiądź, oparcie wsparte o plecy, wałek na dole goleni.",
    "Wyprostuj nogi, napinając uda.",
    "Opuść powoli, pod kontrolą.",
  ], ["Szarpanie ciężaru", "Odrywanie pośladków od siedziska", "Pełna blokada kolan z impetem"]),
  [id(36)]: m("machine", "calf_raise", ["łydki", "wspięcia", "calf raise"], [
    "Stań na palcach na krawędzi stopnia, pięty poniżej.",
    "Wspnij się maksymalnie wysoko na palce.",
    "Opuść pięty poniżej stopnia i powtórz.",
  ], ["Skrócony zakres ruchu", "Bujanie", "Zginanie kolan"]),
  [id(37)]: m("bodyweight", "core_flexion", ["unoszenie nóg", "hanging leg raise", "nogi do drążka"], [
    "Zwiśnij na drążku z wyprostowanymi rękami.",
    "Unieś proste nogi do poziomu lub wyżej, zwijając miednicę.",
    "Opuść powoli, bez bujania.",
  ], ["Bujanie całym ciałem", "Zginanie kolan", "Szarpnięcie zamiast kontroli"]),
  [id(38)]: m("machine", "core_flexion", ["brzuch maszyna", "crunch machine", "spięcia na maszynie"], [
    "Usiądź, chwyć uchwyty przy barkach, stopy zablokowane.",
    "Zwiń tułów w dół, zbliżając klatkę do bioder.",
    "Wróć powoli do pozycji startowej.",
  ], ["Ciągnięcie rękami", "Zbyt duży ciężar", "Szarpanie"]),
  [id(39)]: m("barbell", "push_vertical", ["OHP", "wyciskanie żołnierskie", "military press", "żołnierskie"], [
    "Stań prosto, sztanga na obojczykach, chwyt nieco szerszy niż barki.",
    "Napnij brzuch i pośladki, wypchnij sztangę nad głowę.",
    "Opuść powoli, pod kontrolą na obojczyki.",
  ], ["Mocne wyginanie lędźwi", "Sztanga ciągnięta za głowę", "Odbijanie nogami"]),
  [id(40)]: m("dumbbell", "fly", ["odwrotne rozpiętki", "reverse fly", "tylne barki", "rozpiętki w opadzie"], [
    "Pochyl tułów prawie do poziomu, hantle w opuszczonych rękach.",
    "Unieś ramiona na boki do linii barków, łokcie lekko ugięte.",
    "Opuść powoli.",
  ], ["Bujanie tułowiem", "Zbyt ciężkie hantle", "Unoszenie barków do uszu"]),
  [id(41)]: m("barbell", "curl", ["modlitewnik", "preacher", "biceps na modlitewniku"], [
    "Usiądź, ramiona oparte na poduszce modlitewnika.",
    "Ugnij ramiona, unosząc sztangę do barków.",
    "Opuść powoli do prawie pełnego wyprostu.",
  ], ["Odrywanie ramion od poduszki", "Szarpanie na dole", "Pełny wyprost z impetem"]),
  [id(42)]: m("barbell", "triceps_extension", ["francuz", "skull crusher", "wyciskanie francuskie", "łamacz czaszek"], [
    "Połóż się na ławce, sztanga nad klatką w wyprostowanych rękach.",
    "Zegnij łokcie, opuszczając sztangę do czoła lub za głowę.",
    "Wyprostuj ramiona z powrotem.",
  ], ["Łokcie rozchodzą się na boki", "Za ciężka sztanga", "Opuszczanie za szybko"]),
  [id(43)]: m("cable", "curl", ["lina młotkowe", "rope curl", "młotki na wyciągu"], [
    "Stań przy wyciągu dolnym, chwyć linę neutralnie.",
    "Ugnij ramiona, unosząc linę do barków.",
    "Opuść powoli.",
  ], ["Bujanie tułowiem", "Łokcie do przodu", "Szarpnięcie"]),
  [id(44)]: m("dumbbell", "push_incline", ["skos hantle", "incline press", "klata góra"], [
    "Połóż się na ławce skośnej (30–45°), hantle przy klatce.",
    "Wypchnij hantle w górę nad górną część klatki.",
    "Opuść powoli, pod kontrolą.",
  ], ["Zbyt stromy skos (barki zamiast klatki)", "Łokcie na boki", "Odbijanie od klatki"]),
  [id(45)]: m("machine", "fly", ["butterfly", "pec deck", "rozpiętki na maszynie", "motylek"], [
    "Usiądź z plecami na oparciu, ramiona na poduszkach.",
    "Zbliż ramiona przed klatką, ściskając klatkę.",
    "Wróć powoli do rozwarcia.",
  ], ["Zbyt duże rozciągnięcie z przodu barków", "Odrywanie pleców", "Szarpanie"]),
  [id(46)]: m("cable", "pull_vertical", ["wyciąg górny", "lat pulldown", "ściąganie drążka", "szeroki grzbiet"], [
    "Usiądź, uda zablokowane pod wałkiem, chwyć drążek szeroko.",
    "Ściągnij drążek do górnej części klatki, łokcie w dół.",
    "Wróć powoli do wyprostu rąk.",
  ], ["Ciągnięcie za głowę", "Odchylanie tułowia i bujanie", "Podniesione barki"]),
  [id(47)]: m("barbell", "push_incline", ["skos sztanga", "incline bench", "klata góra sztanga"], [
    "Połóż się na ławce skośnej (30–45°), stopy na podłodze.",
    "Opuść sztangę do górnej części klatki.",
    "Wypchnij do wyprostu rąk.",
  ], ["Zbyt stromy skos", "Odbijanie od klatki", "Odrywanie pośladków"]),
  [id(48)]: m("dumbbell", "push_horizontal", ["hantle na ławce", "dumbbell press", "klata hantle"], [
    "Połóż się na ławce płaskiej, hantle przy klatce.",
    "Wypchnij hantle w górę, zbliżając je nad klatką.",
    "Opuść powoli, pod kontrolą, do poziomu klatki.",
  ], ["Za szeroko rozstawione łokcie", "Za szybkie opuszczanie", "Odbijanie od klatki"]),
  [id(49)]: m("bodyweight", "push_horizontal", ["pompki", "push up", "pushup"], [
    "Podpór na dłoniach nieco szerzej niż barki, ciało w jednej linii.",
    "Opuść klatkę do podłogi, łokcie pod kątem 45°.",
    "Wypchnij się w górę do wyprostu.",
  ], ["Opadające biodra", "Łokcie rozstawione na boki", "Niepełny zakres ruchu"]),
  [id(50)]: m("cable", "fly", ["brama", "cable crossover", "rozpiętki na wyciągach", "krzyżowanie linek"], [
    "Stań między wyciągami, uchwyty na wysokości barków, lekki wykrok.",
    "Zbliż dłonie przed klatką w łuku, łokcie lekko ugięte.",
    "Wróć powoli.",
  ], ["Zginanie i prostowanie łokci", "Bujanie tułowiem", "Zbyt ciężki ciężar"]),
  [id(51)]: m("barbell", "squat", ["przysiad przedni", "front squat"], [
    "Połóż sztangę na przednich barkach, łokcie wysoko.",
    "Zejdź w przysiadzie z prostym tułowiem.",
    "Wstań, dociskając stopy do podłogi.",
  ], ["Opadające łokcie", "Zaokrąglone plecy", "Odrywanie pięt"]),
  [id(52)]: m("dumbbell", "lunge", ["bułgar", "bułgarski", "bulgarian split squat"], [
    "Tylną stopę oprzyj na ławce, hantle w rękach.",
    "Zejdź, zginając przednią nogę, tułów prosto.",
    "Wstań, dociskając przednią stopę.",
  ], ["Za bliska ławki", "Kolano wpada do środka", "Pochylanie tułowia"]),
  [id(53)]: m("dumbbell", "lunge", ["wykroki", "lunges", "wykrok z hantlami"], [
    "Stań z hantlami wzdłuż ciała, zrób duży krok do przodu.",
    "Opuść tylne kolano blisko podłogi.",
    "Wróć do pozycji startowej, odpychając się przednią nogą.",
  ], ["Za krótki krok", "Kolano ucieka do środka", "Przechylanie tułowia"]),
  [id(54)]: m("barbell", "glute_bridge", ["hip thrust", "mostek ze sztangą", "pośladki sztanga"], [
    "Oprzyj łopatki o ławkę, sztanga na biodrach.",
    "Wypchnij biodra w górę do linii barki–biodra–kolana.",
    "Opuść powoli, pod kontrolą.",
  ], ["Wyginanie lędźwi", "Stopy za daleko lub za blisko", "Brak pełnego wyprostu bioder"]),
  [id(55)]: m("dumbbell", "pull_horizontal", ["wiosło jednorącz", "one arm row", "wiosłowanie hantlem"], [
    "Oprzyj dłoń i kolano na ławce, plecy płasko.",
    "Przyciągnij hantel do biodra, łokieć wzdłuż ciała.",
    "Opuść do wyprostu ręki.",
  ], ["Rotowanie tułowia", "Szarpnięcie", "Zbyt krótki ruch"]),
  [id(56)]: m("bodyweight", "pull_vertical", ["podciąganie podchwytem", "chin up", "chinup"], [
    "Chwyć drążek podchwytem na szerokość barków.",
    "Podciągnij się, aż broda znajdzie się nad drążkiem.",
    "Opuść powoli.",
  ], ["Bujanie", "Niepełny zakres", "Zgarbione barki"]),
  [id(57)]: m("machine", "squat", ["hack", "hack squat", "przysiad hack"], [
    "Ustaw się plecami na oparciu, stopy na platformie.",
    "Zejdź, zginając kolana do co najmniej 90°.",
    "Wypchnij się w górę, nie blokując całkiem kolan.",
  ], ["Pięty odrywają się od platformy", "Kolana zapadają się do środka", "Niepełny zakres"]),
  [id(58)]: m("dumbbell", "squat", ["goblet", "przysiad z hantlem", "goblet squat"], [
    "Trzymaj hantel pionowo przy klatce oburącz.",
    "Zejdź w przysiad, łokcie między kolanami.",
    "Wstań, dociskając stopy do podłogi.",
  ], ["Pochylanie się do przodu", "Pięty odrywają się", "Opadający hantel"]),
  [id(59)]: m("machine", "leg_curl", ["uginanie siedząc", "seated leg curl"], [
    "Usiądź, wałek nad piętami, uda zablokowane.",
    "Ugnij nogi, przyciągając wałek pod siedzisko.",
    "Wróć powoli.",
  ], ["Szarpanie", "Odrywanie ud od siedziska", "Niepełny zakres"]),
  [id(60)]: m("dumbbell", "shrug", ["szrugsy", "shrugs", "kaptury", "wzruszanie ramion"], [
    "Stań z hantlami wzdłuż ciała.",
    "Unieś barki prosto w górę do uszu.",
    "Opuść powoli.",
  ], ["Kręcenie barkami", "Zginanie łokci", "Zbyt duży ciężar"]),
  [id(61)]: m("dumbbell", "push_vertical", ["arnoldki", "arnold press", "wyciskanie arnolda"], [
    "Usiądź, hantle przed twarzą dłońmi do siebie.",
    "Wypchnij hantle nad głowę, obracając dłonie na zewnątrz.",
    "Opuść z powrotem z obrotem do pozycji startowej.",
  ], ["Mocne wyginanie lędźwi", "Zbyt szybki obrót", "Za ciężkie hantle"]),
  [id(62)]: m("barbell", "push_horizontal", ["wąski chwyt", "close grip bench", "triceps sztanga leżąc"], [
    "Połóż się na ławce, chwyć sztangę na szerokość barków.",
    "Opuść sztangę do dolnej części klatki, łokcie przy tułowiu.",
    "Wypchnij do wyprostu.",
  ], ["Chwyt zbyt wąski i ból nadgarstków", "Łokcie na boki", "Odbijanie od klatki"]),
  [id(63)]: m("machine", "calf_raise", ["łydki siedząc", "seated calf raise"], [
    "Usiądź, kolana pod poduszką, palce na platformie.",
    "Unieś pięty maksymalnie wysoko.",
    "Opuść pięty poniżej platformy.",
  ], ["Skrócony zakres", "Szarpanie", "Podnoszenie bioder"]),
  [id(64)]: m("bodyweight", "core_flexion", ["brzuszki", "crunch", "spięcia brzucha"], [
    "Połóż się na plecach, kolana ugięte, ręce przy skroniach.",
    "Unieś barki od podłogi, zwijając tułów.",
    "Opuść powoli.",
  ], ["Ciągnięcie za głowę", "Unoszenie całych pleców", "Szarpanie"]),
  [id(65)]: m("barbell", "hinge", ["sumo", "martwy sumo", "sumo deadlift"], [
    "Stań szeroko, palce na zewnątrz, chwyt wewnątrz kolan.",
    "Napnij plecy, wypchnij kolana na zewnątrz.",
    "Wstań, dociskając stopy do podłogi.",
  ], ["Kolana zapadają się do środka", "Zaokrąglone plecy", "Biodra startują za wcześnie"]),
  [id(66)]: m("dumbbell", "fly", ["rozpiętki", "fly", "rozpiętki hantle"], [
    "Połóż się na ławce, hantle nad klatką, łokcie lekko ugięte.",
    "Rozchyl ramiona w łuku, aż poczujesz rozciąganie.",
    "Zbliż hantle łukiem nad klatką.",
  ], ["Prostowanie i zginanie łokci", "Zbyt głębokie opuszczanie", "Za ciężkie hantle"]),
  [id(67)]: m("machine", "push_horizontal", ["wyciskanie na maszynie", "chest press", "klata maszyna"], [
    "Ustaw siedzisko tak, by uchwyty były na wysokości środka klatki.",
    "Wypchnij uchwyty do przodu do wyprostu rąk.",
    "Wróć powoli.",
  ], ["Odrywanie pleców", "Unoszenie barków", "Pełna blokada łokci z impetem"]),
  [id(68)]: m("kettlebell", "hinge", ["kettle", "swing", "machy kettlebell"], [
    "Stań szeroko, kettlebell przed sobą, chwyć oburącz.",
    "Odsuń biodra do tyłu, a potem wypchnij je dynamicznie do przodu.",
    "Kettlebell unosi się do wysokości klatki siłą bioder.",
  ], ["Podnoszenie rękami", "Przysiad zamiast zgięcia bioder", "Wyginanie lędźwi na górze"]),
  [id(69)]: m("other", "core_stability", ["kółko", "ab wheel", "rollout", "brzuch kółko"], [
    "Uklęknij, chwyć kółko, ręce pod barkami.",
    "Wyjedź kółkiem do przodu z napiętym brzuchem.",
    "Wróć kółkiem do kolan.",
  ], ["Wyginanie lędźwi", "Opadanie bioder", "Za daleki zakres na początku"]),
  [id(70)]: m("bodyweight", "core_rotation", ["russian twist", "skręty tułowia", "skosy brzucha"], [
    "Usiądź, odchyl tułów, unieś nogi lekko nad podłogę.",
    "Skręcaj tułów na boki, dotykając podłogi dłońmi lub talerzem.",
    "Powtarzaj płynnie.",
  ], ["Zaokrąglone plecy", "Ruch samymi rękami", "Szybkie machanie"]),
  [id(71)]: m("bodyweight", "core_stability", ["deska bokiem", "side plank"], [
    "Połóż się na boku, oprzyj na przedramieniu pod barkiem.",
    "Unieś biodra do prostej linii od głowy do stóp.",
    "Utrzymaj pozycję, potem zmień stronę.",
  ], ["Opadające biodra", "Skręt tułowia", "Wstrzymywanie oddechu"]),
  [id(72)]: m("dumbbell", "triceps_extension", ["kickback", "prostowanie w opadzie", "triceps hantel"], [
    "Pochyl tułów, plecy płasko, łokieć przy ciele.",
    "Wyprostuj rękę do tyłu, napinając triceps.",
    "Wróć powoli do kąta 90°.",
  ], ["Bujanie ramienia", "Łokieć opada", "Za ciężki hantel"]),
  [id(73)]: m("dumbbell", "curl", ["skoncentrowane", "concentration curl", "biceps siedząc"], [
    "Usiądź, oprzyj łokieć o wewnętrzną stronę uda.",
    "Ugnij ramię, unosząc hantel do barku.",
    "Opuść powoli.",
  ], ["Bujanie tułowiem", "Unoszenie łokcia", "Szybkie opuszczanie"]),
  [id(74)]: m("cable", "curl", ["curl na wyciągu", "biceps wyciąg", "uginanie wyciąg"], [
    "Stań przy wyciągu dolnym, chwyć drążek lub uchwyt.",
    "Ugnij ramiona, łokcie przy tułowiu.",
    "Opuść powoli.",
  ], ["Bujanie tułowiem", "Łokcie do przodu", "Szarpanie"]),
  [id(75)]: m("machine", "hip_abduction", ["odwodzenie", "abduktory", "pośladki maszyna"], [
    "Usiądź, poduszki po zewnętrznej stronie kolan.",
    "Rozchyl nogi na boki, napinając pośladki.",
    "Wróć powoli.",
  ], ["Szarpanie", "Odchylanie tułowia", "Za duży ciężar"]),
  [id(76)]: m("barbell", "hinge", ["good morning", "dzień dobry", "skłony ze sztangą"], [
    "Sztanga na plecach, stopy na szerokość barków, kolana lekko ugięte.",
    "Odsuń biodra do tyłu, pochylając tułów do prawie poziomu.",
    "Wróć, wypychając biodra do przodu.",
  ], ["Zaokrąglone plecy", "Zbyt duży ciężar", "Ugięte kolana jak w przysiadzie"]),
  [id(77)]: m("bodyweight", "dip", ["dipy na ławce", "pompki tyłem", "bench dip"], [
    "Oprzyj dłonie na ławce za plecami, nogi wyprostowane.",
    "Opuść biodra, zginając łokcie do 90°.",
    "Wypchnij się w górę.",
  ], ["Za głębokie zejście", "Łokcie na boki", "Barki uniesione do uszu"]),
  [id(78)]: m("bodyweight", "glute_bridge", ["mostek", "glute bridge", "pośladki bez sprzętu"], [
    "Połóż się na plecach, kolana ugięte, stopy blisko pośladków.",
    "Unieś biodra do prostej linii barki–biodra–kolana.",
    "Opuść powoli.",
  ], ["Wyginanie lędźwi", "Stopy za daleko", "Brak napięcia pośladków"]),
  [id(79)]: m("bodyweight", "plyometric", ["wspinaczka", "mountain climbers", "kolana do klatki"], [
    "Podpór na dłoniach, ciało w jednej linii.",
    "Przyciągaj naprzemiennie kolana do klatki w szybkim tempie.",
    "Utrzymaj biodra nisko.",
  ], ["Biodra za wysoko", "Zbyt szybkie tempo kosztem formy", "Zapadnięte plecy"]),
  [id(80)]: m("cable", "pullover", ["prostymi ramionami", "straight arm pulldown", "pullover na wyciągu"], [
    "Stań przy wyciągu górnym, chwyć drążek prostymi rękami.",
    "Ściągnij drążek łukiem do ud, ramiona wyprostowane.",
    "Wróć powoli.",
  ], ["Zginanie łokci", "Bujanie tułowiem", "Zbyt duży ciężar"]),
  [id(81)]: m("dumbbell", "pullover", ["pullover", "przenoszenie hantla", "pullover hantel"], [
    "Połóż się na ławce, trzymaj hantel oburącz nad klatką.",
    "Opuść go łukiem za głowę, ręce lekko ugięte.",
    "Wróć nad klatkę.",
  ], ["Za głębokie opuszczanie", "Wyginanie lędźwi", "Zginanie łokci jak przy wyciskaniu"]),
  [id(82)]: m("other", "hinge", ["wyprosty", "hyperextension", "ławka rzymska", "dolna część pleców"], [
    "Ustaw się na ławce rzymskiej, biodra na poduszce, stopy zablokowane.",
    "Opuść tułów, a potem wyprostuj go do linii z nogami.",
    "Nie wyginaj pleców powyżej linii.",
  ], ["Nadmierne wyginanie pleców", "Szarpanie", "Zbyt szybkie tempo"]),
  [id(83)]: m("barbell", "raise", ["podciąganie wzdłuż tułowia", "upright row", "wiosło stojąc"], [
    "Stań z wąskim chwytem sztangi przed udami.",
    "Podciągnij sztangę wzdłuż ciała do klatki, łokcie wysoko.",
    "Opuść powoli.",
  ], ["Za wąski chwyt i ból barków", "Szarpanie", "Łokcie poniżej dłoni"]),
  [id(84)]: m("dumbbell", "raise", ["unoszenie przodem", "front raise", "przednie barki"], [
    "Stań prosto, hantle przed udami.",
    "Unieś ramię do przodu do wysokości barków.",
    "Opuść powoli.",
  ], ["Bujanie tułowiem", "Unoszenie powyżej barków", "Za ciężkie hantle"]),
  [id(85)]: m("cable", "raise", ["boki na wyciągu", "cable lateral raise", "unoszenie na wyciągu"], [
    "Stań bokiem do wyciągu dolnego, chwyć uchwyt przeciwną ręką.",
    "Unieś ramię na bok do wysokości barku.",
    "Opuść powoli.",
  ], ["Bujanie tułowiem", "Unoszenie barku do ucha", "Zbyt duży ciężar"]),
  [id(86)]: m("barbell", "push_horizontal", ["ławka skośna w dół", "decline bench", "klata dół"], [
    "Połóż się na ławce skośnej głową w dół, nogi zablokowane.",
    "Opuść sztangę do dolnej części klatki.",
    "Wypchnij do wyprostu.",
  ], ["Odbijanie od klatki", "Zbyt duży ciężar bez asekuracji", "Łokcie na boki"]),
  [id(87)]: m("bodyweight", "pull_horizontal", ["australijskie", "inverted row", "podciąganie poziome"], [
    "Połóż się pod niską sztangą, chwyć ją, ciało w jednej linii.",
    "Podciągnij klatkę do sztangi, łokcie wzdłuż ciała.",
    "Opuść powoli.",
  ], ["Opadające biodra", "Szarpnięcie", "Za krótki zakres"]),
  [id(88)]: m("dumbbell", "lunge", ["wejścia", "step up", "wejścia na skrzynię"], [
    "Stań przed skrzynią z hantlami wzdłuż ciała.",
    "Wejdź na skrzynię jedną nogą, wyprostuj biodro.",
    "Zejdź powoli, pod kontrolą.",
  ], ["Odpychanie się tylną nogą", "Kolano wpada do środka", "Za wysoka skrzynia"]),
  [id(89)]: m("bodyweight", "core_flexion", ["unoszenie nóg leżąc", "leg raise", "dolny brzuch"], [
    "Połóż się na plecach, ręce wzdłuż ciała lub pod pośladkami.",
    "Unieś proste nogi do pionu.",
    "Opuść powoli, nie dotykając podłogi.",
  ], ["Wyginanie lędźwi", "Szarpanie", "Opadające nogi"]),
  [id(90)]: m("bodyweight", "core_rotation", ["rowerek", "bicycle crunch", "skosy rowerek"], [
    "Połóż się na plecach, ręce przy skroniach.",
    "Przyciągaj naprzemiennie kolano do przeciwległego łokcia.",
    "Prostuj drugą nogę nad podłogą.",
  ], ["Ciągnięcie za głowę", "Zbyt szybkie tempo", "Opadające plecy"]),
  [id(91)]: m("machine", "hip_adduction", ["przywodzenie", "przywodziciele", "adduktory"], [
    "Usiądź, poduszki po wewnętrznej stronie kolan.",
    "Zbliż nogi do siebie, napinając przywodziciele.",
    "Wróć powoli.",
  ], ["Szarpanie", "Za duży ciężar", "Odchylanie tułowia"]),
  [id(92)]: m("dumbbell", "carry", ["farmer", "spacer farmera", "farmers walk", "chód z ciężarem"], [
    "Weź ciężkie hantle w dłonie, stań prosto, barki z tyłu.",
    "Idź krokami średniej długości, trzymając tułów prosto.",
    "Odłóż ciężar powoli, pod kontrolą.",
  ], ["Garbienie się", "Kołysanie ciężarem", "Unoszenie barków do uszu"]),
  [id(93)]: m("bodyweight", "plyometric", ["wskoki", "box jump", "skok na skrzynię"], [
    "Stań przed skrzynią na szerokość barków.",
    "Zrób przysiad i wyskocz na skrzynię, lądując miękko na obu stopach.",
    "Zejdź krokiem, nie skokiem.",
  ], ["Lądowanie na sztywnych nogach", "Za wysoka skrzynia", "Zeskakiwanie"]),
  [id(94)]: m("cable", "core_rotation", ["drwal", "woodchopper", "skosy na wyciągu"], [
    "Stań bokiem do wyciągu, chwyć uchwyt oburącz.",
    "Pociągnij ukośnie w dół przez ciało, obracając tułów.",
    "Wróć powoli.",
  ], ["Ruch samymi rękami", "Szarpanie", "Wyginanie lędźwi"]),
  [id(95)]: m("machine", "push_vertical", ["barki maszyna", "shoulder press maszyna", "wyciskanie barki maszyna"], [
    "Ustaw siedzisko tak, by uchwyty były na wysokości barków.",
    "Wypchnij uchwyty nad głowę.",
    "Opuść powoli, pod kontrolą.",
  ], ["Wyginanie lędźwi", "Unoszenie barków do uszu", "Szarpnięcie"]),
  [id(96)]: m("cable", "glute_bridge", ["odwodzenie w tył", "kickback na wyciągu", "pośladki wyciąg"], [
    "Zapnij pasek na kostce, chwyć uchwyt maszyny.",
    "Odwiedź nogę w tył, napinając pośladek.",
    "Wróć powoli.",
  ], ["Wyginanie lędźwi", "Bujanie tułowiem", "Szarpnięcie"]),
};

/**
 * Zapisuje sprzęt, rodzaj ruchu, inne nazwy i opis techniki ćwiczeń
 * systemowych. Idempotentne (nic nie robi, gdy dane się zgadzają), więc działa
 * przy każdym starcie. Zwraca liczbę zmienionych ćwiczeń.
 */
export const syncSystemExerciseMeta = async (
  client: Pick<pg.PoolClient, "query">,
): Promise<number> => {
  const entries = Object.entries(SYSTEM_EXERCISE_META);
  const result = await client.query(
    `UPDATE exercises e
        SET equipment = meta.equipment,
            pattern = meta.pattern,
            aliases = ARRAY(SELECT jsonb_array_elements_text(meta.aliases)),
            instructions = meta.instructions
       FROM (
         SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::jsonb[], $5::jsonb[])
           AS t (id, equipment, pattern, aliases, instructions)
       ) AS meta
      WHERE e.id = meta.id
        AND e.is_system
        AND (e.equipment IS DISTINCT FROM meta.equipment
             OR e.pattern IS DISTINCT FROM meta.pattern
             OR to_jsonb(e.aliases) IS DISTINCT FROM meta.aliases
             OR e.instructions IS DISTINCT FROM meta.instructions)`,
    [
      entries.map(([id]) => id),
      entries.map(([, m]) => m.equipment),
      entries.map(([, m]) => m.pattern),
      entries.map(([, m]) => JSON.stringify(m.aliases)),
      entries.map(([, m]) => JSON.stringify(m.instructions)),
    ],
  );
  return result.rowCount ?? 0;
};
