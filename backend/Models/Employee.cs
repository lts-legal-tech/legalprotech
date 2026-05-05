namespace mydb_putty_101.Models
{
    public class Employee
    {
        public int EmployeeId { get; set; }
        public string EmployeeName { get; set; } = string.Empty;
        public string Department { get; set; } = string.Empty;
        public string DateOfJoining { get; set; } = string.Empty;
        public string PhotoFileName { get; set; } = string.Empty;
    }
}
