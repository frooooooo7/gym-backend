/**
 * Most common passwords that still satisfy the length / uppercase / digit
 * rules (so `Password1` passes the regexes but is among the first guesses of
 * any credential-stuffing list). Compared case-insensitively.
 */
const COMMON_PASSWORDS = new Set([
  "password1", "password12", "password123", "password1234", "password12345",
  "password2", "password01", "password11", "password99", "passw0rd",
  "passw0rd1", "p@ssw0rd", "p@ssword1", "p@ssword123", "pa55word",
  "pa55w0rd", "qwerty123", "qwerty1234", "qwerty12345", "qwertyuiop1",
  "qwerty123456", "qwerty1", "qwerty12", "qwertyui1", "1qaz2wsx",
  "1q2w3e4r", "1q2w3e4r5t", "1qazxsw2", "zaq12wsx", "zaq1zaq1",
  "asdfghjkl1", "asdf1234", "asdfgh123", "zxcvbnm123", "zxcvbnm1",
  "abc12345", "abcd1234", "abcde12345", "abc123456", "abcd12345",
  "abcdefg1", "abcdefgh1", "abcd123456", "12345678a", "123456789a",
  "123456abc", "1234qwer", "1234abcd", "12345qwert", "a1234567",
  "a12345678", "a123456789", "aa123456", "aaaa1111", "aaaaaa11",
  "welcome1", "welcome12", "welcome123", "welcome01", "welcome2024",
  "welcome2025", "letmein1", "letmein12", "letmein123", "admin123",
  "admin1234", "admin12345", "administrator1", "root1234", "test1234",
  "test12345", "test123456", "testtest1", "user1234", "login123",
  "master123", "master12", "dragon123", "dragon12", "monkey123",
  "monkey12", "shadow123", "shadow12", "sunshine1", "sunshine12",
  "princess1", "princess12", "football1", "football12", "football123",
  "baseball1", "basketball1", "iloveyou1", "iloveyou12", "iloveyou123",
  "trustno1", "superman1", "superman12", "batman123", "michael1",
  "jordan23", "jennifer1", "charlie1", "hunter123", "ashley123",
  "summer2020", "summer2021", "summer2022", "summer2023", "summer2024",
  "summer2025", "winter2020", "winter2021", "winter2022", "winter2023",
  "winter2024", "winter2025", "spring2024", "spring2025", "autumn2024",
  "autumn2025", "changeme1", "changeme123", "default123", "secret123",
  "secret12", "mypassword1", "mypassword123", "myp@ssw0rd", "haslo1234",
  "haslo12345", "haslo123", "hasło123", "hasło1234",
  "polska123", "polska12", "polska1234", "kocham123", "kochamcie1",
  "kochampolske1", "maslo123", "maslo1234", "qazwsx123", "qazwsxedc1",
  "gym12345", "gym123456", "workout1", "workout123", "fitness123",
  "stronger1", "stronger123", "trening123", "trening1234", "silownia1",
  "silownia123",
]);

export const isCommonPassword = (value: string): boolean =>
  COMMON_PASSWORDS.has(value.toLowerCase());
