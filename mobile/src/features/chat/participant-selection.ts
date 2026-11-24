import type { Person } from './types';

export function pickerPeople(
  available: Person[],
  selected: Person[],
  actor: string,
  excluded: string[],
  query: string,
) {
  const term = query.trim().toLocaleLowerCase();
  return [...new Map([...selected, ...available].map((person) => [person.id, person])).values()]
    .filter(
      (person) =>
        person.id !== actor &&
        !excluded.includes(person.id) &&
        person.display_name.toLocaleLowerCase().includes(term),
    )
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export function toggleParticipant(current: Person[], person: Person, max: number): Person[] {
  return current.some((item) => item.id === person.id)
    ? current.filter((item) => item.id !== person.id)
    : current.length < max
      ? [...current, person]
      : current;
}
